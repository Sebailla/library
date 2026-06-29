/**
 * Preload script for the `@alejandria/mac` Electron shell (PR-4C,
 * issue #75).
 *
 * Runs in an isolated context with `contextIsolation: true`,
 * `nodeIntegration: false`, `sandbox: true` (see `src/main.ts`).
 * The ONLY thing this file does is publish a typed, frozen surface
 * to `window.alejandria` via `contextBridge.exposeInMainWorld`.
 *
 * The renderer (Next.js at `http://localhost:3001` in dev, the
 * packaged `app://./prod` URL in production) calls these four
 * methods; each one forwards to an IPC channel that the main
 * process handles (see `src/ipc-handlers.ts`):
 *
 *   - `download(bookId)` → `aleja:download` (NAS download flow)
 *   - `sync(direction)`  → `aleja:sync`    (iCloud sync engine)
 *   - `scan(localPath)`  → `aleja:scan`    (spawn the Python sidecar)
 *   - `version()`        → `aleja:version` (Electron / Node / Chrome)
 *
 * Why a context bridge instead of `nodeIntegration: true`?
 * Because the renderer is a plain Next.js app that has no idea
 * it's running inside Electron. Exposing Node primitives would
 * (a) widen the attack surface, (b) break the isomorphic build
 * because the renderer code also runs in a real browser, and
 * (c) couple every web feature to the Electron version.
 *
 * The surface is `Object.freeze`-d in `expose()` so a compromised
 * renderer cannot swap implementations out at runtime.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

/**
 * Public type contract for the bridge. Mirrored in the renderer
 * via a hand-written `apps/web/types/alejandria.d.ts` (added in a
 * follow-up PR) so the Next.js side gets autocomplete + type
 * checking without a build step.
 */
export interface AlejandriaBridge {
  /**
   * Ask the main process to download a book from the NAS
   * (PR-2 / PR-4A).
   */
  download(bookId: string): Promise<unknown>
  /**
   * Trigger the iCloud sync engine. `direction` is either
   * `'pull'` (remote → local) or `'push'` (local → remote).
   */
  sync(direction: 'pull' | 'push'): Promise<unknown>
  /**
   * Ask the main process to spawn the Python sidecar against a
   * local file and return the parsed envelope. `localPath` MUST
   * be an absolute path inside the configured library root — the
   * shared `@alejandria/sidecar.sanitizePath` enforces this in
   * `src/ipc-handlers.ts`.
   */
  scan(localPath: string): Promise<unknown>
  /**
   * Return the Electron / Node / Chrome version triplet so the
   * About dialog can show what shipped.
   */
  version(): Promise<unknown>
}

const CHANNELS = {
  download: 'aleja:download',
  sync: 'aleja:sync',
  scan: 'aleja:scan',
  version: 'aleja:version',
} as const

const bridge: AlejandriaBridge = Object.freeze({
  download: (bookId: string) => ipcRenderer.invoke(CHANNELS.download, bookId),
  sync: (direction: 'pull' | 'push') => ipcRenderer.invoke(CHANNELS.sync, direction),
  scan: (localPath: string) => ipcRenderer.invoke(CHANNELS.scan, localPath),
  version: () => ipcRenderer.invoke(CHANNELS.version),
})

/**
 * Publish the bridge onto `window.alejandria`. Exposed as a named
 * export so unit tests can call it without booting Electron.
 */
export function expose(): void {
  contextBridge.exposeInMainWorld('alejandria', bridge)
}

// Side-effect: when this file is loaded as the actual preload
// script (see `main.ts → webPreferences.preload`), publish the
// bridge automatically.
expose()

// Keep `IpcRendererEvent` import alive for future event-listener
// bridges (download progress, scan progress) added in a follow-up
// PR. The unused-binding trick avoids the noUnusedLocals rule
// without resorting to `// @ts-ignore`.
type _IpcRendererEventKept = IpcRendererEvent
