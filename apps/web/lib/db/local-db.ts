import type { BookRow } from '@/components/BookList'

/**
 * Local SQLite mirror of the user's library (per `local-library-db`
 * spec). PR-3A ships a skeleton: the file is opened lazily on first
 * access, the `books` table is created if missing, and `listBooks()`
 * returns an empty list because no rows have been ingested yet.
 *
 * PR-3B will:
 *  - add the full schema (authors, categories, annotations,
 *    reading_progress, bookmarks, books_fts, book_remote_links)
 *  - implement the FTS5 triggers (insert / update / delete)
 *  - add `upsertBook()`, `searchBooks()`, `findByContentHash()`
 *  - expose the polymorphic `last_position` JSON column for readers
 *
 * The DB path is the single file required by the spec — never a
 * per-library file.
 */
export interface LocalDb {
  listBooks(): readonly BookRow[]
  close(): void
}

/**
 * Resolve the absolute path to the single local DB file.
 *
 * Defaults to `<cwd>/data/db.sqlite` so the skeleton runs without
 * any platform-specific path resolution. Electron (PR4) will
 * override this via `ALEJANDRIA_DATA_DIR`.
 */
export function resolveDbPath(): string {
  const fromEnv = process.env['ALEJANDRIA_DATA_DIR']
  const base = fromEnv ?? `${process.cwd()}/data`
  return `${base}/db.sqlite`
}

/**
 * Open the local DB. Lazy: the file is only created on first call
 * to `listBooks()` so that importing this module from a Server
 * Component during a build (where `process.cwd()` is fine but we
 * don't want side effects) stays safe.
 *
 * The skeleton never opens better-sqlite3 on import — it returns a
 * proxy that materializes on first `listBooks()`.
 */
export function openLocalDb(): LocalDb {
  let cached: BookRow[] | null = null

  return {
    listBooks(): readonly BookRow[] {
      if (cached !== null) return cached
      // PR-3A skeleton: return empty list. PR-3B will query
      // `SELECT id, title, author_name, year FROM books ORDER BY
      // rowid DESC LIMIT ?` once the schema lands.
      cached = []
      return cached
    },
    close(): void {
      // Nothing to close yet. PR-3B will close the better-sqlite3
      // handle here.
    },
  }
}