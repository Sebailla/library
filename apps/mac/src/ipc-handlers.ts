/**
 * IPC handler registration for the `@alejandria/mac` Electron
 * shell (PR-4C, issue #75).
 *
 * The renderer (Next.js) calls `window.alejandria.download(...)`
 * etc. via the preload bridge. Each call lands here as an
 * `ipcMain.handle(channel, fn)` invocation. This module:
 *
 *   1. Registers exactly the four channels specified in #75.
 *   2. Validates every payload (renderer can be untrusted).
 *   3. Routes the work to injected services (`downloader`,
 *      `syncer`, `sidecar`) so the main process stays thin and
 *      unit-testable.
 *   4. Exposes a `unregisterIpcHandlers()` helper for graceful
 *      shutdown / hot-reload.
 *
 * Channel ↔ method mapping (mirrors `src/preload.ts`):
 *   - `aleja:download` → `downloader.download(bookId)`
 *   - `aleja:sync`     → `syncer.sync(direction)`
 *   - `aleja:scan`     → `sidecar.getProcess()` then parse envelope
 *   - `aleja:version`  → build version object from `process` + `app`
 */

import { app, ipcMain, type IpcMainInvokeEvent } from 'electron'
import process from 'node:process'

import type { SidecarManager } from './sidecar-manager'
import { parseSidecarEnvelope, type SidecarRequestOptions } from './sidecar-client'

/** Channel names. Kept in one place so preload + handlers agree. */
export const IPC_CHANNELS = {
  download: 'aleja:download',
  sync: 'aleja:sync',
  scan: 'aleja:scan',
  version: 'aleja:version',
} as const

export type SyncDirection = 'pull' | 'push'

/**
 * The downloader service: takes a `bookId`, performs the NAS
 * download (PR-2 / PR-4A), returns a serializable result.
 * Injected so tests can supply a vi.fn().
 */
export interface Downloader {
  download(bookId: string): Promise<unknown>
}

/**
 * The iCloud sync service: takes a direction, runs the sync
 * engine, returns a serializable result. Injected for tests.
 */
export interface Syncer {
  sync(direction: SyncDirection): Promise<unknown>
}

/**
 * Optional override for the sidecar process invocation. The
 * default is to spawn the sidecar via the injected
 * `SidecarManager` and pipe a request envelope to its stdin.
 * Tests inject a stub that returns a canned envelope.
 */
export interface SidecarInvoker {
  getProcess(): Promise<{
    stdin: { write(s: string): void; end(): void } | null
    stdout: { on(_: 'data', cb: (chunk: Buffer) => void): void } | null
    stderr: { on(_: 'data', cb: (chunk: Buffer) => void): void } | null
    on(event: 'exit', cb: (code: number | null) => void): void
    on(event: 'error', cb: (err: Error) => void): void
  }>
}

export interface RegisterOptions {
  sidecar: SidecarManager
  downloader: Downloader
  syncer: Syncer
  /**
   * Override how the scan handler drives the sidecar (test
   * seam). Default: pipe a JSON request to the sidecar's stdin
   * and parse the JSON envelope from its stdout.
   */
  scanImpl?: (payload: SidecarRequestOptions['payload']) => Promise<unknown>
}

/**
 * Reject the IPC call with a serializable Error. The renderer's
 * `ipcRenderer.invoke` will see the rejection reason and can
 * surface it to the user.
 */
function rejectInvalid(message: string): Promise<never> {
  return Promise.reject(new Error(message))
}

/**
 * Validate that `value` is a non-empty string. Returns the
 * value narrowed to `string` on success, or rejects with a
 * descriptive message on failure.
 */
function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`ipc: ${field} must be a non-empty string`)
  }
  return value
}

function requireDirection(value: unknown): SyncDirection {
  if (value !== 'pull' && value !== 'push') {
    throw new Error(`ipc: direction must be "pull" or "push"`)
  }
  return value
}

/**
 * Default scan implementation: pipe the request to the sidecar's
 * stdin, collect the JSON envelope from stdout, parse and return
 * it. The contract is the versioned envelope used everywhere in
 * the project (see `packages/sidecar/src/sidecar-process.ts`).
 */
async function defaultScanImpl(
  sidecar: SidecarManager,
  payload: SidecarRequestOptions['payload'],
): Promise<unknown> {
  const child = await sidecar.getProcess()
  return new Promise((resolve, reject) => {
    let stdoutBuf = ''
    let stderrBuf = ''
    let settled = false
    const settle = (fn: () => void): void => {
      if (settled) return
      settled = true
      fn()
    }
    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString('utf8')
    })
    child.on('exit', (code) => {
      if (code !== 0) {
        settle(() => reject(new Error(`sidecar exited with code ${code}: ${stderrBuf}`)))
        return
      }
      try {
        settle(() => resolve(parseSidecarEnvelope(stdoutBuf)))
      } catch (err) {
        settle(() =>
          reject(
            err instanceof Error ? err : new Error(`sidecar envelope parse failed: ${String(err)}`),
          ),
        )
      }
    })
    child.on('error', (err) => {
      settle(() => reject(err))
    })
    if (child.stdin) {
      child.stdin.write(JSON.stringify(payload))
      child.stdin.end()
    } else {
      settle(() => reject(new Error('sidecar stdin is not writable')))
    }
  })
}

/**
 * Register the four `ipcMain.handle` listeners. Returns the list
 * of registered channels so tests can assert on it and so
 * `unregisterIpcHandlers()` knows what to tear down.
 */
export function registerIpcHandlers(options: RegisterOptions): readonly string[] {
  const { sidecar, downloader, syncer, scanImpl } = options
  const scan = scanImpl ?? ((payload) => defaultScanImpl(sidecar, payload))

  ipcMain.handle(IPC_CHANNELS.download, async (_event: IpcMainInvokeEvent, bookId: unknown) => {
    const id = requireString(bookId, 'bookId')
    return downloader.download(id)
  })

  ipcMain.handle(IPC_CHANNELS.sync, async (_event: IpcMainInvokeEvent, direction: unknown) => {
    const dir = requireDirection(direction)
    return syncer.sync(dir)
  })

  ipcMain.handle(IPC_CHANNELS.scan, async (_event: IpcMainInvokeEvent, localPath: unknown) => {
    const path = requireString(localPath, 'localPath')
    return scan({ type: 'extract', localPath: path })
  })

  ipcMain.handle(IPC_CHANNELS.version, async () => ({
    electron: process.versions.electron ?? 'unknown',
    node: process.versions.node,
    chrome: process.versions.chrome ?? 'unknown',
    app: app.getVersion(),
  }))

  return Object.values(IPC_CHANNELS)
}

/**
 * Remove every handler registered by {@link registerIpcHandlers}.
 * Safe to call when nothing is registered (the IPC layer no-ops
 * in that case). Used by `main.ts` during `before-quit`.
 */
export function unregisterIpcHandlers(): void {
  for (const channel of Object.values(IPC_CHANNELS)) {
    try {
      ipcMain.removeHandler(channel)
    } catch {
      /* not registered — fine */
    }
  }
}

/**
 * Internal: produce a synthetic rejection that callers can
 * `await` to test validation paths without going through the
 * IPC harness. Re-exported so unit tests can exercise the same
 * code path used by the renderer's invoke promises.
 */
export const __testing = { rejectInvalid }
