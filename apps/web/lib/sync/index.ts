/**
 * iCloud Drive activity sync — public surface (PR-4B, #73).
 *
 * Re-exports every public type and function from the
 * sync layer so callers can write
 *
 *   import { createSyncEngine, getICloudDir } from '@/lib/sync'
 *
 * without learning the internal file layout.
 *
 * Modeled after the isbn-resolver module (PR-4A) so the
 * project has one consistent "public surface per package"
 * convention: types + factories at the top level, internal
 * layout hidden.
 */

export type {
  ActivityCategory,
  Bookmark,
  Highlight,
  MergeResult,
  Note,
  ReadingProgress,
  SyncFile,
  SyncFs,
  SyncPayload,
  SyncEngineDeps,
  Watcher,
  WatcherEvent,
} from './types'

export {
  APPLE_ICLOUD_DRIVE_SUBDIR,
  ALEJANDRIA_ICLOUD_NAMESPACE,
  ICLOUD_DIR_ENV,
  getICloudDir,
  getSyncFilePath,
} from './path'

export {
  writeSyncFile,
  writePayload,
  defaultNow,
  type WriteArgs,
  type WriterDeps,
} from './writer'

export {
  createWatcher,
  defaultChokidar,
  type ChokidarFn,
  type StatFn,
  type WatcherDeps,
} from './watcher'

export {
  resolveSyncConflict,
  lastWriteWins,
  defaultResolveConflict,
  type LwwOutcome,
} from './conflict-resolver'

export {
  createSyncEngine,
  type SyncEngine,
  type ManualWatcher,
  type CreateSyncEngineArgs,
} from './sync-engine'

/**
 * Bundled "ready to ship" engine. Wires the real macOS
 * chokidar watcher, a real `node:fs/promises` filesystem,
 * an idempotent JSON decoder, and the LWW resolver. Most
 * callers (the reader UI, the catalog) should use this
 * factory instead of wiring the deps themselves.
 *
 * For tests, prefer `createSyncEngine` with manually
 * constructed deps.
 */
export { createDefaultEngine } from './engine-factory'
