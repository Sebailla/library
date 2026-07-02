/**
 * Main process entry point for `@alejandria/mac` (PR-4C, issue #75;
 * PR-N8, issue #94; PR-fix-mac-window-standalone-bundle).
 *
 * Wires the four layers of the Electron shell:
 *
 *   1. The lifecycle (this file) — `app.whenReady`, `before-quit`,
 *      `window-all-closed`.
 *   2. The `BrowserWindow` — contextIsolation, sandbox, no node
 *      integration, loads the Next.js dev URL in development and
 *      the **Next.js standalone server** URL in production.
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
 *   - Prod:  `http://127.0.0.1:<port>` where `<port>` is the
 *            free port the standalone server bound to (see
 *            `./standalone-server.ts`).
 *
 * Why the change? PR-fix-mac-window-standalone-bundle replaces
 * the previous `app://./index.html` load (which silently failed
 * because no HTML file was bundled) with a real HTTP server
 * running inside the .app. The standalone server is built by
 * the `prepackage` npm hook (see `package.json`) and bundled via
 * `extraResources` in `forge.config.ts`.
 */

import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'

import { registerIpcHandlers, unregisterIpcHandlers } from './ipc-handlers'
import { SidecarManager } from './sidecar-manager'
import { createNasDownloader, type NasDownloader } from './downloader'
import { createIcloudSyncer } from './syncer'
import { createUpdater } from './updater'
import {
  getFreePort,
  getRendererUrl,
  packagedStandaloneDir,
  resolveStandaloneEntry,
  startStandaloneServer,
  stopStandaloneServer,
  waitForRenderer,
  type ChildProcessLike,
} from './standalone-server'
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

/**
 * The URL the production renderer should load. Populated by
 * `bootstrap()` AFTER the standalone server is reachable. The
 * indirection through a getter is what lets the same
 * `createMainWindow()` code path serve dev and prod.
 */
let prodRendererUrl: string | null = null

/**
 * Decide the URL the `BrowserWindow` should load. Centralised
 * here so dev / prod share the same webPreferences code path.
 *
 * In production we read the URL the bootstrap step set (it
 * points at the standalone server's `http://127.0.0.1:<port>`).
 * In dev we fall back to the Next.js dev server URL.
 */
function rendererUrl(): string {
  // `ELECTRON_RENDERER_URL` is set by `electron-forge start` in
  // the dev preset; if it's missing AND we're not packaged we
  // still try the dev URL (the user might be running Next.js
  // in another terminal).
  if (!app.isPackaged) {
    return process.env['ELECTRON_RENDERER_URL'] ?? DEV_RENDERER_URL
  }
  // Production — bootstrap() must have spawned the standalone
  // server and stored its URL here. If somehow we get here before
  // the server is ready we fall back to the dev URL so the user
  // sees a meaningful error (404 page) instead of `app://` failing
  // silently.
  return prodRendererUrl ?? DEV_RENDERER_URL
}

/**
 * Detect whether the host macOS version supports `vibrancy: 'sidebar'`
 * on a frameless `BrowserWindow` (PR-A, REQ-MVF-005).
 *
 * macOS Sonoma (14) ships reliable `vibrancy` rendering; Big Sur (11)
 * and Monterey (12) accept the option but the visual degrades, and on
 * older builds Electron has been observed to skip the effect entirely.
 * We require macOS 14+ for vibrancy and fall back to a flat background
 * color on everything older. The OS version comes from
 * `process.getSystemVersion()` which Electron exposes on `darwin`.
 */
function supportsVibrancy(): boolean {
  if (process.platform !== 'darwin') return false
  const ver = process.getSystemVersion?.() ?? '0.0'
  const major = parseInt(ver.split('.')[0] ?? '0', 10)
  return Number.isFinite(major) && major >= 14
}

/**
 * Build the `BrowserWindow` options object. Vibrancy + backgroundMaterial
 * are only added when the host supports them — Electron refuses to set
 * them after construction, so the option has to be present (or absent)
 * at creation time. We never mutate after construction.
 */
function buildWindowOptions(): Electron.BrowserWindowConstructorOptions {
  const base: Electron.BrowserWindowConstructorOptions = {
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Alejandría',
    // PR-A: hiddenInset titlebar + custom traffic-light position so the
    // app can paint a custom topbar (PR-B's `.drag-region`) under the
    // native controls.
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 14 },
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
  }
  if (supportsVibrancy()) {
    // Sonoma+: native translucent sidebar look.
    base.vibrancy = 'sidebar'
    base.backgroundMaterial = 'auto'
  } else {
    // Big Sur / Monterey / non-darwin: flat color keeps the chrome
    // legible instead of showing the OS-default white flash on launch.
    base.backgroundColor = '#141416'
  }
  return base
}

/**
 * Create the single top-level `BrowserWindow`. The window holds
 * the Next.js renderer, the preload script, and nothing else —
 * everything privileged runs in the main process.
 */
function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow(buildWindowOptions())

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
 * The Next.js standalone server child process (production only).
 * Spawned in `bootstrap()` and torn down in `before-quit` so the
 * dev/prod split stays in one place.
 */
let standaloneServer: ChildProcessLike | null = null

/**
 * Bootstrap the shell. The function is intentionally small so
 * its lifecycle is easy to read top-to-bottom:
 *
 *   1. wait for `app.whenReady`
 *   2. (prod) spawn the Next.js standalone server and wait for
 *      it to be reachable
 *   3. create the window
 *   4. create the sidecar, downloader, syncer, updater
 *   5. register the IPC handlers
 *   6. subscribe to teardown signals
 */
async function bootstrap(): Promise<void> {
  await app.whenReady()

  // In production, spin up the bundled Next.js standalone server
  // before opening the window so `loadURL` resolves immediately.
  // We pick a free port, spawn the server, then wait until the
  // port answers before letting `createMainWindow` go ahead.
  if (app.isPackaged) {
    const port = await getFreePort()
    const standaloneDir = packagedStandaloneDir(process.resourcesPath)
    const entryPath = resolveStandaloneEntry({ standaloneDir })
    standaloneServer = startStandaloneServer({
      entryPath,
      host: '127.0.0.1',
      port,
    })
    await waitForRenderer({ host: '127.0.0.1', port })
    prodRendererUrl = getRendererUrl({ host: '127.0.0.1', port })
  }

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
  if (sidecar === null && syncerRef === null && standaloneServer === null) return
  // Otherwise, intercept the quit, kill the sidecar + standalone
  // server cleanly, close the chokidar handle, and let the
  // process exit. The sidecar's SIGTERM→SIGKILL escalation
  // guarantees we don't block shutdown forever.
  event.preventDefault()
  const sidecarRef = sidecar
  const syncerSave = syncerRef
  const standaloneRef = standaloneServer
  sidecar = null
  syncerRef = null
  standaloneServer = null
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
      // The standalone server is bound to a port we picked at
      // bootstrap time; SIGTERM lets Next.js close the listener
      // cleanly so the OS reclaims the port.
      if (standaloneRef !== null) {
        try {
          await stopStandaloneServer(standaloneRef)
        } catch (err: unknown) {
          // eslint-disable-next-line no-console
          console.error('[mac] failed to stop standalone server during quit', err)
        }
      }
      app.exit(0)
    })
})

bootstrap().catch((err: unknown) => {
  console.error('[mac] bootstrap failed — exiting', err)
  // Show a native dialog so the user knows what happened instead
  // of a blank / invisible app.
  void import('electron').then(({ dialog }) => {
    void dialog.showErrorBox(
      'Alejandría could not start',
      `A critical error occurred during startup:\n\n${String(err)}`,
    )
  })
  app.exit(1)
})
