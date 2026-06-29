/**
 * iCloud Drive sync writer (PR-4B, issue #73).
 *
 * The writer is intentionally the only module that knows
 * how `SyncFile` translates to bytes on disk. Everything
 * else (the engine, the watcher, the conflict resolver)
 * hands it a payload and the writer takes care of:
 *
 *   - looking up the canonical file path;
 *   - creating the per-category directory if missing;
 *   - stamping `updatedAt` from an injectable clock so
 *     tests can advance time deterministically;
 *   - serializing the `SyncFile` envelope with `version=1`
 *     so a future migration can still parse what we wrote.
 *
 * We do NOT use atomic rename here: Apple Books does not
 * (iCloud Drive's own daemon handles partial-write
 * recovery via its own change tracking), and introducing
 * a second on-disk protocol would put us out of step
 * with the client we are modeling this on.
 */

import type {
  ActivityCategory,
  Note,
  Highlight,
  Bookmark,
  ReadingProgress,
  SyncFile,
  SyncFs,
  SyncPayload,
} from './types'
import { getSyncFilePath } from './path'

/**
 * Deps the writer accepts. `fs` is injected so tests
 * can use an in-memory map; `now` is injected so we can
 * pin the timestamp without depending on the OS clock.
 *
 * Production callers should pass `{ fs: realFs, now: () =>
 * new Date().toISOString() }`; the engine wires this up
 * in `createSyncEngine`.
 */
export interface WriterDeps {
  fs: SyncFs
  /**
   * Producer for the `updatedAt` stamp. Defaults to the
   * current real time so callers that do not care about
   * determinism don't have to wire anything.
   */
  now?: () => string
}

/**
 * The minimal arguments `writeSyncFile` needs. The
 * factory accepts a flattened form instead of a
 * `SyncPayload` discriminated union because callers
 * (currently the engine) already branch on `category`
 * before calling.
 */
export interface WriteArgs {
  fs: SyncFs
  /** Absolute iCloud Drive root for this app. */
  icloudDir: string
  category: ActivityCategory
  bookId: string
  /** Activity to persist. */
  payload: Note | Highlight | Bookmark | ReadingProgress
  /** Optional deterministic clock. */
  now?: () => string
}

/**
 * Default `now()` — emits the current real time as an
 * ISO-8601 string. Exported so engine tests can stub the
 * module-level default if needed.
 */
export function defaultNow(): string {
  return new Date().toISOString()
}

/**
 * Persist `payload` under
 * `<icloudDir>/<category>/<bookId>.json`.
 *
 * Steps:
 *   1. Compute the canonical path via `getSyncFilePath`.
 *   2. Ensure the category directory exists (idempotent).
 *   3. Build the `SyncFile` envelope.
 *   4. `JSON.stringify` and write atomically-by-name
 *      (no rename — see top-of-file rationale).
 *
 * Why accept `icloudDir` and not a full `WriterDeps`?
 * The engine passes a single shared `fs` but computes
 * `icloudDir` per-call (it can change between calls in
 * tests); bundling both into one bag would force a
 * pointless merge.
 */
export async function writeSyncFile(args: WriteArgs): Promise<void> {
  const { fs, icloudDir, category, bookId, payload } = args
  const now = args.now ?? defaultNow
  const filePath = getSyncFilePath(icloudDir, category, bookId)
  const categoryDir = filePath.substring(0, filePath.lastIndexOf('/'))
  await fs.mkdir(categoryDir, { recursive: true })
  const envelope: SyncFile = {
    version: 1,
    bookId,
    category,
    updatedAt: now(),
    payload,
  }
  await fs.writeFile(filePath, JSON.stringify(envelope))
}

/**
 * Variant of `writeSyncFile` that accepts a discriminated
 * union. Useful for callers (engine, app code) that hold
 * a `SyncPayload` they have not yet branched on.
 *
 * Returns the file path that was written so the caller
 * can later log it or hand it to the watcher.
 */
export async function writePayload(
  deps: WriterDeps & { icloudDir: string },
  payload: SyncPayload,
): Promise<string> {
  await writeSyncFile({
    fs: deps.fs,
    icloudDir: deps.icloudDir,
    category: payload.category,
    bookId: payload.bookId,
    payload: payload.data,
    now: deps.now,
  })
  return getSyncFilePath(deps.icloudDir, payload.category, payload.bookId)
}
