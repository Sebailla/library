/**
 * iCloud Drive sync engine for the `@alejandria/mac` Electron
 * shell (PR-N8, issue #94).
 *
 * The renderer triggers `window.alejandria.sync('pull' | 'push')`
 * when the user taps the Sync button. This module is the actual
 * implementation behind the IPC handler stub from PR-4C.
 *
 * Two phases:
 *
 *   pull — sync the iCloud Drive directory with the local library
 *          cache. Implemented as a chokidar scan with
 *          `ignoreInitial: false` so every existing file shows up
 *          at startup (the mac shell uses this to seed the local
 *          SQLite cache).
 *
 *   push — observe writes to the iCloud directory and emit a
 *          `change` event per file. The mac app uses this to keep
 *          the local mirror up to date as the user annotates
 *          books.
 *
 * Chokidar is chosen because it:
 *
 *   - handles macOS FSEvents correctly (the polling fallback would
 *     drain battery on Apple Silicon),
 *   - emits absolute paths so the renderer never has to resolve
 *     relative-to-mac-app locations,
 *   - supports `awaitWriteFinish` so a not-yet-flushed file does
 *     not cause a partial read by the local cache.
 *
 * The watcher is a module-level state so the IPC layer can keep
 * its dependency on a single object across scans (same contract as
 * the PR-4C stub).
 *
 * Strict TDD: the public surface (`createIcloudSyncer`,
 * `IcloudSyncer`, `Syncer`) is mirrored in
 * `__tests__/syncer.integration.test.ts`.
 */

import { EventEmitter } from 'node:events'
import chokidar, { type FSWatcher } from 'chokidar'

/** Direction reported back to the IPC layer so the renderer can label the result. */
export type SyncDirection = 'pull' | 'push'

/** Pull-phase result. */
export interface IcloudPullResult {
  ok: true
  direction: 'pull'
  files: readonly string[]
  transport: 'icloud'
}

/** Push-phase per-file change event. */
export interface IcloudChangeEvent {
  path: string
  kind: 'add' | 'change' | 'unlink'
}

/** Options for {@link createIcloudSyncer}. */
export interface IcloudSyncerOptions {
  /** Directory chokidar watches. Defaults to ~/Library/Mobile Documents/iCloud~com~alejandria~app/. */
  cloudDir?: string
  /** Inject chokidar (tests pass `require('chokidar')` of a fake). */
  chokidarImpl?: typeof chokidar
  /** Debounce window for chokidar's `awaitWriteFinish` (default 200 ms). */
  awaitWriteFinishMs?: number
  /** Override the lstat seam (tests inject a fake that ignores permissions). */
  lstat?: (path: string) => Promise<unknown>
}

/** Contract satisfied by every syncer (interface so other backends can replace this one). */
export interface Syncer {
  sync(direction: SyncDirection): Promise<unknown>
  pull(): Promise<IcloudPullResult>
  on(event: 'change', listener: (file: string) => void): this
  close(): Promise<void>
}

/** Default iCloud Drive root for the bundled `com.alejandria.app` container. */
export function defaultIcloudDir(): string {
  // Lazy import so the test environment (without `os`) does not
  // crash if someone reads this function in a node-only context.
  const os = require('node:os') as { homedir: () => string }
  return `${os.homedir()}/Library/Mobile Documents/iCloud~com~alejandria~app`
}

/**
 * Implementation of the iCloud syncer. Wraps chokidar's
 * `FSWatcher` in an `EventEmitter`-style API so the IPC layer can
 * subscribe to `change` events regardless of the underlying
 * library.
 */
export class IcloudSyncer extends EventEmitter implements Syncer {
  readonly #cloudDir: string
  readonly #watcher: FSWatcher | null
  #closed = false

  constructor(watcher: FSWatcher | null, cloudDir: string) {
    super()
    this.#cloudDir = cloudDir
    this.#watcher = watcher
  }

  /** One-shot pull: list every file currently in the cloud directory. */
  async pull(): Promise<IcloudPullResult> {
    // The pull contract is a snapshot read against the filesystem,
    // NOT a query against the watcher's internal state. A snapshot
    // is what the local cache wants — chokidar may still be
    // indexing at startup, but the local cache needs an answer
    // synchronously enough to render the first frame.
    const fs = await import('node:fs/promises')
    const stack: string[] = [this.#cloudDir]
    const out: string[] = []
    while (stack.length > 0) {
      const dir = stack.pop() as string
      let entries: import('node:fs').Dirent[]
      try {
        entries = await fs.readdir(dir, { withFileTypes: true })
      } catch {
        // Directory disappeared mid-walk (a user trashed it
        // mid-sync, for example). Drop it; the next pull() picks
        // up the new state.
        continue
      }
      for (const entry of entries) {
        const full = `${dir}/${entry.name}`
        if (entry.isDirectory()) {
          stack.push(full)
        } else if (entry.isFile()) {
          out.push(full)
        }
      }
    }
    return { ok: true, direction: 'pull', files: out, transport: 'icloud' }
  }

  /** IPC entry point. Returns whatever `pull()` returned for `'pull'`, or a `push` heartbeat for `'push'`. */
  async sync(direction: SyncDirection): Promise<unknown> {
    if (direction === 'pull') {
      return this.pull()
    }
    // For 'push' we do not actually transmit (the local cache is
    // already up to date via chokidar's `change` events). We just
    // signal that the cycle is complete.
    return { ok: true, direction: 'push', transport: 'icloud' as const }
  }

  /** Tear down the underlying watcher. Idempotent. */
  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    if (this.#watcher !== null) {
      await this.#watcher.close()
    }
  }
}

/**
 * Build an {@link IcloudSyncer}. The factory indirection keeps
 * the IPC handler's `registerIpcHandlers({ syncer })` call ergonomic.
 */
export function createIcloudSyncer(options: IcloudSyncerOptions = {}): IcloudSyncer {
  const cloudDir = options.cloudDir ?? defaultIcloudDir()
  const chokidarImpl = options.chokidarImpl ?? chokidar
  const watcher = chokidarImpl.watch(cloudDir, {
    ignoreInitial: false,
    persistent: true,
    awaitWriteFinish: { pollInterval: 50, stabilityThreshold: options.awaitWriteFinishMs ?? 200 },
    depth: 99,
  }) as FSWatcher
  const syncer = new IcloudSyncer(watcher, cloudDir)
  // Drain any per-event streams chokidar emits so the listener
  // registration happens BEFORE the `ready` event fires (the
  // first `add` events for existing files arrive between
  // construction and `ready`). Without this, an integration
  // test that writes a file immediately after the factory
  // returns can race the listener registration.
  watcher.on('add', (path) => syncer.emit('change', path))
  watcher.on('change', (path) => syncer.emit('change', path))
  watcher.on('unlink', (path) => syncer.emit('change', path))
  return syncer
}

/**
 * Build an {@link IcloudSyncer} and resolve once chokidar has
 * emitted its `ready` event (i.e. the initial scan is complete
 * and every subsequent write will be observed). Tests SHOULD use
 * this so the watcher is fully wired before they write to the
 * directory; production callers (the IPC handler) can use the
 * simpler {@link createIcloudSyncer} because they do not write
 * during startup.
 */
export function createIcloudSyncerReady(
  options: IcloudSyncerOptions = {},
): Promise<IcloudSyncer> {
  return new Promise((resolve, reject) => {
    const cloudDir = options.cloudDir ?? defaultIcloudDir()
    const chokidarImpl = options.chokidarImpl ?? chokidar
    const watcher = chokidarImpl.watch(cloudDir, {
      ignoreInitial: false,
      persistent: true,
      awaitWriteFinish: { pollInterval: 50, stabilityThreshold: options.awaitWriteFinishMs ?? 200 },
      depth: 99,
    }) as FSWatcher
    let settled = false
    const settle = (fn: () => void): void => {
      if (settled) return
      settled = true
      fn()
    }
    watcher.once('ready', () => {
      const syncer = new IcloudSyncer(watcher, cloudDir)
      watcher.on('add', (path) => syncer.emit('change', path))
      watcher.on('change', (path) => syncer.emit('change', path))
      watcher.on('unlink', (path) => syncer.emit('change', path))
      settle(() => resolve(syncer))
    })
    watcher.once('error', (err) => settle(() => reject(err)))
  })
}

/**
 * Build a "no watcher" syncer (used by tests that want to assert
 * on `pull()`'s directory walk without booting chokidar). The
 * returned syncer still walks the directory once for the pull
 * phase; `on('change', ...)` never fires.
 */
export function createIcloudSyncerFromFs(
  options: IcloudSyncerOptions = {},
): IcloudSyncer {
  const cloudDir = options.cloudDir ?? defaultIcloudDir()
  // No watcher — direct filesystem walk.
  return new IcloudSyncer(null, cloudDir)
}
