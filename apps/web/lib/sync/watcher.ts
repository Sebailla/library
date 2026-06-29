/**
 * iCloud Drive sync watcher (PR-4B, issue #73).
 *
 * Thin wrapper around `chokidar` that exposes only the
 * three events the engine cares about (`add`, `change`,
 * `unlink`). It exists so the engine never imports
 * `chokidar` directly and so tests can inject a
 * deterministic emitter.
 *
 * Why not just `import chokidar from 'chokidar'` at the
 * call site? Because:
 *   1. Chokidar is hard to mock — its constructor returns
 *      an `FSWatcher` that is itself an `EventEmitter`,
 *      and tests typically want to assert construction
 *      args without booting a real watcher.
 *   2. Our surface is small (3 events + start + close);
 *      a small wrapper is easier to type than `chokidar`'s
 *      overload set.
 *   3. On macOS real chokidar fallback (fsevents) requires
 *      the macOS binary; isolating it in one place makes
 *      it easy to swap on non-darwin.
 *
 * `ChokidarFn` is a single-argument constructor that
 * returns an `FSWatcher`. Production passes chokidar's
 * default `watch` factory; tests pass a recorder.
 */

import chokidar, { type FSWatcher } from 'chokidar'
import type { Watcher, WatcherEvent } from './types'

/**
 * Constructor signature our wrapper consumes. Exposed so
 * tests can swap in a recorder without touching the real
 * chokidar module.
 */
export type ChokidarFn = (
  path: string,
  options?: Record<string, unknown>,
) => FSWatcher

/**
 * Default factory — wraps `chokidar.watch` for production.
 * Pulled out as a constant so we never call `chokidar.watch`
 * at import time (which would crash on platforms without
 * fsevents).
 */
export const defaultChokidar: ChokidarFn = (p, opts) =>
  chokidar.watch(p, opts as chokidar.WatchOptions) as unknown as FSWatcher

/**
 * Per-call stat factory. The production default is
 * `fs.promises.stat`; tests inject a mock.
 */
export type StatFn = (path: string) => Promise<{ mtimeMs: number }>

/**
 * Arguments accepted by `createWatcher`.
 */
export interface WatcherDeps {
  icloudDir: string
  stat: StatFn
  /** Defaults to chokidar.watch on darwin; override in tests. */
  chokidar?: ChokidarFn
}

/**
 * Construct a `Watcher` over the given iCloud directory.
 *
 * Why `ignoreInitial: false`? Pull-on-startup needs to
 * read every existing file once. With `ignoreInitial:
 * true`, chokidar would only fire for files added
 * post-watch — leaving startup blind to files that
 * already exist on disk.
 *
 * We DO NOT pass `awaitWriteFinish`. iCloud Drive itself
 * takes care of partial-write recovery; attempting to
 * debounce here would actually race with the daemon.
 */
export function createWatcher(deps: WatcherDeps): Watcher {
  const watch = deps.chokidar ?? defaultChokidar
  const stat = deps.stat
  const handlers: Array<(e: WatcherEvent) => void> = []
  let fsWatcher: FSWatcher | null = null
  let closed = false

  // Kick off the watcher eagerly at construction time so
  // pull-on-startup sees existing files. `start()` becomes
  // a no-op once called.
  const fsWatcherInstance = watch(deps.icloudDir, {
    ignoreInitial: false,
    awaitWriteFinish: false,
    // Watch only files; the per-book files we care about
    // have a `.json` extension managed by the writer.
    ignored: (p: string) => !p.endsWith('.json'),
  })
  fsWatcher = fsWatcherInstance

  function emit(event: WatcherEvent): void {
    if (closed) return
    for (const h of handlers) h(event)
  }

  fsWatcherInstance.on('add', (filePath: string) => {
    void stat(filePath).then(
      ({ mtimeMs }) => emit({ filePath, kind: 'add', mtimeMs }),
      () => emit({ filePath, kind: 'add', mtimeMs: 0 }),
    )
  })
  fsWatcherInstance.on('change', (filePath: string) => {
    void stat(filePath).then(
      ({ mtimeMs }) => emit({ filePath, kind: 'change', mtimeMs }),
      () => emit({ filePath, kind: 'change', mtimeMs: 0 }),
    )
  })
  fsWatcherInstance.on('unlink', (filePath: string) => {
    emit({ filePath, kind: 'unlink', mtimeMs: null })
  })
  // Swallow chokidar's `error` so an EACCES on a flaky
  // iCloud Drive mount does not crash the host process;
  // the engine re-reads files on the next add/change.
  fsWatcherInstance.on('error', () => {
    /* noop */
  })

  return {
    start(): void {
      // No-op: the watcher is created and listening at
      // construction time. Kept on the interface so callers
      // do not have to know about the eager policy.
    },

    async close(): Promise<void> {
      closed = true
      if (fsWatcher) {
        const w = fsWatcher
        fsWatcher = null
        await w.close()
      }
    },

    onEvent(handler: (event: WatcherEvent) => void): void {
      handlers.push(handler)
    },
  }
}
