/**
 * Main process entry point for `@alejandria/mac` (PR-4C, issue #75;
 * PR-N8, issue #94).
 *
 * Wires the four layers of the Electron shell:
 *
 *   1. The lifecycle (this file) — `app.whenReady`, `before-quit`,
 *      `window-all-closed`.
 *   2. The `BrowserWindow` — contextIsolation, sandbox, no node
 *      integration, loads the Next.js dev URL in development and
 *      the packaged `app://./prod` URL in production.
 *   3. The preload script (`./preload.ts`) — exposes
 *      `window.alejandria` via contextBridge.
 *   4. The IPC handlers (`./ipc-handlers.ts`) — four channels:
 *      `aleja:download`, `aleja:sync`, `aleja:scan`,
 *      `aleja:version`.
 *   5. PR-N8: the REAL downloader (`./downloader.ts`), the REAL
 *      syncer (`./syncer.ts`), and the REAL auto-updater
 *      (`./updater.ts`). Each satisfies the interfaces the IPC
 *      layer registered in PR-4C.
 *
 * The sidecar manager (`./sidecar-manager.ts`) is owned by the
 * main process and reused across all `aleja:scan` invocations
 * so the Python interpreter keeps its in-memory cache.
 *
 * Security model (issue #75 acceptance criteria):
 *   - `contextIsolation: true`  — renderer cannot reach Node
 *   - `nodeIntegration: false`  — renderer has no `require`
 *   - `sandbox: true`           — preload runs in a restricted
 *                                 process
 *
 * Dev / prod URL convention:
 *   - Dev:   `http://localhost:3001` (matches the Next.js dev
 *            server started by `npm --prefix apps/web run dev`).
 *   - Prod:  `file://…/out/prod/index.html` (electron-forge
 *            `app://./` URL scheme registered in
 *            `forge.config.ts`).
 */

import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'

import { registerIpcHandlers, unregisterIpcHandlers } from './ipc-handlers'
import { SidecarManager } from './sidecar-manager'
import { createNasDownloader, type NasDownloader } from './downloader'
import { createIcloudSyncer } from './syncer'
import { createUpdater } from './updater'
import { join as pathJoin } from 'node:path'
import { mkdir } from 'node:fs/promises'

/**
 * Default destination directory for downloaded books.
 * Mirrors `apps/mac/README.md → Where your data lives`:
 * `~/Library/Application Support/alejandria/books/`.
 *
 * On a TTY-less test runner the path may not exist; the bridge
 * creates it on demand.
 */
async function defaultDownloadDir(): Promise<string> {
  const os = await import('node:os')
  return pathJoin(os.homedir(), 'Library', 'Application Support', 'alejandria', 'books')
}

/**
 * Bridge the renderer-facing `downloader.download(bookId)` (which
 * expects an absolute path was already chosen by the IPC layer)
 * into the real NAS downloader's `download(bookId, destPath)` API.
 *
 * The bridge picks `defaultDownloadDir()` for the destination and
 * surfaces the completion envelope the NAS returned. We keep the
 * IPC contract narrow because the renderer is untrusted — moving
 * the destination decision into the main process is the secure
 * pattern.
 */
function createIpcDownloader(nas: NasDownloader): {
  download(bookId: string): Promise<unknown>
} {
  return {
    async download(bookId: string): Promise<unknown> {
      const destDir = await defaultDownloadDir()
      await mkdir(destDir, { recursive: true })
      return nas.download(Number(bookId), pathJoin(destDir, `${bookId}.bin`))
    },
  }
}

/** Address the renderer should load. In dev, the Next.js dev server. */
const DEV_RENDERER_URL = 'http://localhost:3001'

/** Filename of the Next.js static export consumed in production. */
const PROD_RENDERER_FILE = 'index.html'

/**
 * Decide the URL the `BrowserWindow` should load. Centralised
 * here so dev / prod share the same webPreferences code path.
 */
function rendererUrl(): string {
  // `ELECTRON_RENDERER_URL` is set by `electron-forge start` in
  // the dev preset; if it's missing AND we're not packaged we
  // still try the dev URL (the user might be running Next.js
  // in another terminal).
  if (!app.isPackaged) {
    return process.env['ELECTRON_RENDERER_URL'] ?? DEV_RENDERER_URL
  }
  // In production the renderer is loaded via the `app://`
  // protocol registered in `forge.config.ts`.
  return `app://./${PROD_RENDERER_FILE}`
}

/**
 * Create the single top-level `BrowserWindow`. The window holds
 * the Next.js renderer, the preload script, and nothing else —
 * everything privileged runs in the main process.
 */
function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Alejandría',
    webPreferences: {
      // Security: the renderer is a Next.js app that has no
      // business touching Node. The preload script is the only
      // thing that gets to use `contextBridge`.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The compiled preload script is at `dist/preload.js`
      // (see `forge.config.ts`).
      preload: join(__dirname, 'preload.js'),
    },
  })

  win.once('ready-to-show', () => {
    win.show()
  })

  // Open external links in the user's default browser, never in
  // a new Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Block in-app navigations to anywhere that isn't the
  // renderer (security: don't let a malicious page push the
  // user to a phishing URL).
  win.webContents.on('will-navigate', (event, url) => {
    const target = rendererUrl()
    if (!url.startsWith(target)) {
      event.preventDefault()
    }
  })

  void win.loadURL(rendererUrl())
  return win
}

/**
 * The sidecar manager is a module-level singleton so the
 * `before-quit` handler can reach it without us having to
 * thread a reference through every callback.
 */
let sidecar: SidecarManager | null = null

/**
 * The iCloud syncer is also a module-level singleton. The
 * `before-quit` handler closes the chokidar handle so the
 * libuv loop doesn't keep Electron alive after the last
 * window closes.
 */
let syncerRef: { close: () => Promise<void> } | null = null

/**
 * Bootstrap the shell. The function is intentionally small so
 * its lifecycle is easy to read top-to-bottom:
 *
 *   1. wait for `app.whenReady`
 *   2. create the window
 *   3. create the sidecar, downloader, syncer, updater
 *   4. register the IPC handlers
 *   5. subscribe to teardown signals
 */
async function bootstrap(): Promise<void> {
  await app.whenReady()

  sidecar = new SidecarManager({
    command: 'python',
    args: ['-m', 'alejandria_sidecar'],
  })

  // PR-N8 — real implementations. The downloader hits the NAS
  // over HTTP; the syncer watches the iCloud Drive folder; the
  // updater wires `electron-updater` to `process.env.GH_TOKEN`.
  const baseUrl = process.env['ALEJANDRIA_NAS_URL']
  const token = process.env['ALEJANDRIA_NAS_TOKEN']
  const nasDownloader = createNasDownloader(
    token !== undefined ? { baseUrl, token } : { baseUrl },
  )
  const downloader = createIpcDownloader(nasDownloader)
  const syncer = createIcloudSyncer({})
  syncerRef = syncer
  await syncer.pull()

  const updater = await createUpdater()
  // Wire the updater into a quiet status emitter so the renderer
  // can subscribe via `window.alejandria` in a follow-up PR.
  void updater.checkForUpdates().catch(() => {
    /* dev or no-update — silently ignored */
  })

  registerIpcHandlers({ sidecar, downloader, syncer })
  createMainWindow()

  app.on('activate', () => {
    // macOS: re-create the window when the dock icon is
    // clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
}

app.on('window-all-closed', () => {
  // macOS apps usually stay alive when the last window closes;
  // everywhere else we quit so the user gets a clean exit.
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', (event) => {
  // If we've already torn down, let the default quit proceed.
  if (sidecar === null && syncerRef === null) return
  // Otherwise, intercept the quit, kill the sidecar cleanly,
  // close the chokidar handle, and let the process exit. The
  // sidecar's SIGTERM→SIGKILL escalation guarantees we don't
  // block shutdown forever.
  event.preventDefault()
  const sidecarRef = sidecar
  const syncerSave = syncerRef
  sidecar = null
  syncerRef = null
  unregisterIpcHandlers()
  void syncerSave
    ?.close()
    .catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error('[mac] failed to close syncer during quit', err)
    })
    .finally(async () => {
      try {
        await sidecarRef?.kill()
      } catch (err: unknown) {
        // eslint-disable-next-line no-console
        console.error('[mac] failed to kill sidecar during quit', err)
      }
      app.exit(0)
    })
})

void bootstrap()
