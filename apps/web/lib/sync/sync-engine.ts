/**
 * iCloud Drive sync engine (PR-4B, issue #73).
 *
 * The engine is the only object app code interacts with.
 * It owns three responsibilities and nothing else:
 *
 *   1. **pull** — on `start()` read every JSON file under
 *      the iCloud root and build an in-memory index
 *      `Map<filePath, SyncFile>`. App code asks the index
 *      with `get(path)` / `listAll()`.
 *
 *   2. **push** — `push(note)` writes a `SyncFile` to
 *      disk via the writer and refreshes the index. It
 *      also notifies any `onChange` subscribers.
 *
 *   3. **merge** — when chokidar reports an external
 *      change (a different device wrote a file), the
 *      engine fetches the new version from disk and runs
 *      it through `resolveConflict` against the in-memory
 *      value. Whichever version wins replaces the index
 *      entry; identical versions are dropped silently.
 *
 * The engine deliberately does NOT use a real chokidar
 * instance inside the module — the `Watcher` is injected
 * via `SyncEngineDeps` so tests can pass a deterministic
 * emitter. Production wires a chokidar-backed watcher
 * through `createSyncEngine`.
 */

import type {
  MergeResult,
  Note,
  Highlight,
  Bookmark,
  ReadingProgress,
  SyncEngineDeps,
  SyncFile,
  SyncPayload,
  WatcherEvent,
} from './types'
import { getSyncFilePath } from './path'
import { writeSyncFile } from './writer'

/**
 * Public surface the engine exposes to app code.
 *
 * `start()` is async because pull-on-startup reads N
 * files; `close()` is async because chokidar's `close()`
 * is. `push` is async because the writer is async.
 */
export interface SyncEngine {
  /** Walk the iCloud root and load every existing file. */
  start(): Promise<void>
  /** Stop the watcher and release any handles. */
  close(): Promise<void>
  /**
   * Persist a payload. Writes to disk, then updates the
   * in-memory index. Returns the file path so callers can
   * log or inspect it.
   */
  push(payload: SyncPayload): Promise<string>
  /** Look up the in-memory copy of one file. */
  get(filePath: string): Promise<SyncFile | null>
  /** List every file path currently indexed. */
  listAll(): Promise<string[]>
  /** Subscribe to merged/pushed changes (per-file). */
  onChange(handler: (sf: SyncFile) => void): void
}

/**
 * Args accepted by `createSyncEngine`. The `Watcher` is
 * typed structurally here so engine tests can pass a
 * manual emitter without importing chokidar.
 */
export type CreateSyncEngineArgs = SyncEngineDeps

/**
 * Manual, in-process Watcher implementation. Used by
 * tests to feed deterministic events without booting
 * chokidar. Production never instantiates this.
 *
 * Exported (not just internal) because callers writing
 * their own integration tests benefit from reusing it
 * rather than rebuilding the helper.
 */
export interface ManualWatcher {
  start(): void
  close(): Promise<void>
  onEvent(handler: (e: WatcherEvent) => void): void
  emit(event: WatcherEvent): void
}

/**
 * Build the engine. The factory bundles the four collaborators
 * (`fs`, `watcher`, `decode`, `resolveConflict`) plus a
 * deterministic clock and an optional output handler list.
 */
export function createSyncEngine(args: CreateSyncEngineArgs): SyncEngine {
  const { fs, watcher, decode, resolveConflict } = args
  const index = new Map<string, SyncFile>()
  const changeHandlers: Array<(sf: SyncFile) => void> = []

  function fireChange(sf: SyncFile): void {
    for (const h of changeHandlers) h(sf)
  }

  async function readSyncFile(filePath: string): Promise<SyncFile | null> {
    let raw: string
    try {
      raw = await fs.readFile(filePath)
    } catch {
      // Likely ENOENT mid-flight; treat as absent.
      index.delete(filePath)
      return null
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = null
    }
    // `decode` decides what a valid envelope looks like,
    // including (when given `null`) whether absence-of-data
    // is itself a parse error. Engine never throws — if
    // decode returns null we drop the entry silently.
    return decode(parsed) ?? null
  }

  // Subscribe once at construction time so the engine
  // does not need a separate `start()` for the watcher.
  // The first `start()` call from app code is purely the
  // initial pull.
  watcher.onEvent(async (event) => {
    if (event.kind === 'unlink') {
      index.delete(event.filePath)
      return
    }
    const fresh = await readSyncFile(event.filePath)
    if (!fresh) return
    const known = index.get(event.filePath)
    if (!known) {
      // New file from another device — index it as-is.
      index.set(event.filePath, fresh)
      fireChange(fresh)
      return
    }
    const outcome: MergeResult<SyncFile> = resolveConflict({
      local: known,
      remote: fresh,
      localMtimeMs: known.updatedAt ? Date.parse(known.updatedAt) : null,
      remoteMtimeMs: event.mtimeMs,
    })
    if (outcome.identical) return
    index.set(event.filePath, outcome.winner)
    fireChange(outcome.winner)
  })

  async function pull(): Promise<void> {
    const categoryDirs = await safeReaddir(args.icloudDir)
    for (const dir of categoryDirs) {
      const entries = await safeReaddir(dir)
      for (const entry of entries) {
        // Skip non-`.json` entries (e.g. macOS `.DS_Store`,
        // subfolders created by a future migration).
        if (!entry.endsWith('.json')) continue
        const parsed = await readSyncFile(entry)
        if (parsed) index.set(entry, parsed)
      }
    }
  }

  async function safeReaddir(dir: string): Promise<string[]> {
    try {
      return await fs.readdir(dir)
    } catch {
      // Directory may not exist yet on first launch — that
      // is normal, return [].
      return []
    }
  }

  return {
    async start(): Promise<void> {
      // Watcher has been eagerly started at construction
      // (see watcher.ts); here we run the pull and give
      // the watcher a moment to deliver its initial `add`
      // events.
      await pull()
    },

    async close(): Promise<void> {
      await watcher.close()
    },

    async push(payload: SyncPayload): Promise<string> {
      const filePath = getSyncFilePath(args.icloudDir, payload.category, payload.bookId)
      await writeSyncFile({
        fs,
        icloudDir: args.icloudDir,
        category: payload.category,
        bookId: payload.bookId,
        payload: payload.data as Note | Highlight | Bookmark | ReadingProgress,
      })
      // Read the file back so the in-memory copy is the
      // canonical envelope (with the writer's updatedAt).
      const reread = await readSyncFile(filePath)
      if (reread) {
        index.set(filePath, reread)
        fireChange(reread)
      }
      return filePath
    },

    async get(filePath: string): Promise<SyncFile | null> {
      const v = index.get(filePath)
      return v ?? null
    },

    async listAll(): Promise<string[]> {
      return [...index.keys()].sort()
    },

    onChange(handler: (sf: SyncFile) => void): void {
      changeHandlers.push(handler)
    },
  }
}
