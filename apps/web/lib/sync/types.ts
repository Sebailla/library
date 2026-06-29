/**
 * iCloud Drive activity sync — types (PR-4B, issue #73).
 *
 * Modeled after Apple Books: every reading activity
 * (note, highlight, bookmark, progress) is persisted as
 * a small JSON file inside the user's iCloud Drive
 * folder, under
 *
 *   ~/Library/Mobile Documents/com~apple~cloudDocs/Alejandria/
 *
 * so it syncs transparently across every device the user
 * owns without us running a server. Conflicts between
 * devices are resolved by file `mtime` (last write wins)
 * because the Apple Books client follows the same rule
 * — we match its behavior rather than invent our own.
 *
 * Every type below is intentionally serializable
 * (`JSON.stringify`-safe) so writing to disk is trivial.
 *
 * Out of scope for this PR: the Electron shell (PR-4C),
 * apple-js-bundler integration, and any real AppleScript
 * to enumerate iCloud Drive files. The sync engine below
 * works on whatever directory the OS provides (real
 * iCloud Drive in production, a tmp dir in tests).
 */

/**
 * One of the four supported activity kinds. Used as the
 * top-level folder name inside the iCloud root — keeping
 * each kind in its own subdirectory means a user can open
 * the folder in Finder and see four labeled buckets.
 */
export type ActivityCategory = 'notes' | 'highlights' | 'bookmarks' | 'progress'

/**
 * A reading note attached to a single book at a single
 * CFI / page locator. Free-form UTF-8 text; we do not
 * validate it here. `createdAt` is informational and
 * only used for display — conflict resolution trusts
 * `updatedAt` exclusively.
 */
export interface Note {
  id: string
  bookId: string
  /** CFI for epubs, page number for pdfs, etc. */
  locator: string
  text: string
  createdAt: string // ISO-8601
  updatedAt: string // ISO-8601
}

/**
 * A highlighted passage. `color` is an opaque hex string
 * (Apple Books uses `#FFD60A`, `#FFEB3B`, `#A7F3D0`,
 * etc.) but we accept any valid CSS color and store it
 * verbatim so the UI can render Apple Books's exact
 * palette without translation.
 */
export interface Highlight {
  id: string
  bookId: string
  locator: string
  text: string
  color?: string
  createdAt: string
  updatedAt: string
}

/**
 * A user-saved position in a book. Distinct from
 * `ReadingProgress` because bookmarks are user-explicit
 * ("remember this page") while progress is implicit
 * ("I scrolled here while reading"). Apple Books keeps
 * them separate too.
 */
export interface Bookmark {
  id: string
  bookId: string
  locator: string
  label?: string
  createdAt: string
  updatedAt: string
}

/**
 * Implicit reading position. `percent` is in [0, 1] and
 * `currentLocator` is the deepest position reached. Both
 * fields are independent — a user at page 30 of 100 may
 * have percent=0.30 OR may have skimmed past page 30
 * back to page 10 (percent=0.10, currentLocator=30).
 */
export interface ReadingProgress {
  bookId: string
  currentLocator: string
  percent: number
  updatedAt: string
}

/**
 * Discriminated union — the writer / reader / conflict
 * resolver all branch on this so callers do not have to
 * juggle four different shapes.
 */
export type SyncPayload =
  | { category: 'notes'; bookId: string; data: Note }
  | { category: 'highlights'; bookId: string; data: Highlight }
  | { category: 'bookmarks'; bookId: string; data: Bookmark }
  | { category: 'progress'; bookId: string; data: ReadingProgress }

/**
 * The on-disk envelope around every payload. We persist
 * `version` so a future schema migration can read old
 * files without crashing. `bookId` lives at the top level
 * (and inside the payload) for two reasons:
 *  1. it makes the file path derivable without parsing;
 *  2. it lets a directory listing quickly enumerate the
 *     books with any activity, even if the payload is
 *     unparseable.
 */
export interface SyncFile {
  version: 1
  bookId: string
  category: ActivityCategory
  /** ISO-8601; used as the canonical conflict timestamp. */
  updatedAt: string
  /** One of the four payload variants, by `category`. */
  payload: Note | Highlight | Bookmark | ReadingProgress
}

/**
 * Event emitted by the chokidar watcher. `mtimeMs` is
 * taken from `fs.stat` and is what the conflict resolver
 * compares against `payload.updatedAt` — keeping both
 * signals explicit lets us write a deterministic test
 * without touching the real filesystem clock.
 */
export interface WatcherEvent {
  /** Absolute path of the file that changed. */
  filePath: string
  /** Kind of chokidar event that produced this. */
  kind: 'add' | 'change' | 'unlink'
  /** File mtime in ms-since-epoch. `null` on `unlink`. */
  mtimeMs: number | null
}

/**
 * Subscribable handle returned by `createWatcher`.
 * Decouples the engine from chokidar so tests can swap
 * in a deterministic emitter.
 */
export interface Watcher {
  /** Begin emitting events; safe to call once. */
  start(): void
  /** Stop emitting and release chokidar handles. */
  close(): Promise<void>
  /** Listener receives one event per fs change. */
  onEvent(handler: (event: WatcherEvent) => void): void
}

/**
 * Result of merging two concurrent versions of the same
 * activity (e.g. one from this device, one from another).
 * `winner` carries the surviving version; `loser` is
 * returned for callers that want to log or display the
 * dropped edit.
 */
export interface MergeResult<T> {
  winner: T
  loser: T | null
  /** `true` if both inputs were equal (no edit happened). */
  identical: boolean
}

/**
 * Dependencies the `SyncEngine` accepts. Every entry is
 * overridable so tests can inject an in-memory filesystem
 * and a fake watcher; production passes the real ones.
 *
 * `cwd` here is the iCloud root *for this app*, which
 * may differ from the OS-level iCloud Drive root when the
 * caller wants to namespace multiple installs.
 */
export interface SyncEngineDeps {
  /** iCloud directory for this app (default = path.getICloudDir()). */
  icloudDir: string
  /** Filesystem operations injected for testability. */
  fs: SyncFs
  /** Watcher injected for testability. */
  watcher: Watcher
  /** Decoder / encoder for chokidar payloads. */
  decode(payload: unknown): SyncFile | null
  /**
   * Resolver chooses the winner between two SyncFiles.
   * Receives an options object so we can extend it with
   * `localMtimeMs` / `remoteMtimeMs` later without
   * breaking callers.
   */
  resolveConflict: (args: {
    local: SyncFile
    remote: SyncFile
    localMtimeMs?: number | null
    remoteMtimeMs?: number | null
  }) => MergeResult<SyncFile>
}

/**
 * Minimal filesystem seam. We only need the operations
 * the engine uses; abstracting the whole `node:fs` keeps
 * the engine testable without a tmp dir.
 */
export interface SyncFs {
  readdir(dir: string): Promise<string[]>
  readFile(path: string): Promise<string>
  writeFile(path: string, contents: string): Promise<void>
  unlink(path: string): Promise<void>
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>
  stat(path: string): Promise<{ mtimeMs: number }>
}
