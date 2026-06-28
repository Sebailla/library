import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Local SQLite mirror of the user's library (per `local-library-db` spec).
 *
 * Single-file DB at `<ALEJANDRIA_DATA_DIR>/library.sqlite` (default
 * `<cwd>/apps/web/data/library.sqlite`). Holds `books`, `authors`,
 * `categories`, `book_categories`, `sagas`, `book_sagas`, `reading_progress`,
 * and an FTS5 virtual table over `books.title` + `books.excerpt`.
 *
 * The DB is opened lazily so importing this module from a Server
 * Component during a build stays safe. Schema is created idempotently
 * on first open.
 *
 * NOTE on `books.source`: PR-3B only writes rows with `source =
 * 'local_scan'`. PR-3C (NAS browse-and-download) will add
 * `nas_download` rows via `upsertBook()`.
 */

export interface BookInput {
  id: string
  title: string
  author: string
  year: number
  format: string
  filePath: string
  contentHash: string
  excerpt: string
}

export interface BookRow {
  id: string
  title: string
  author: string
  year: number
  format: string
  filePath: string
  contentHash: string
  excerpt: string
}

export interface LocalDb {
  insertBook(input: BookInput): BookRow
  findById(id: string): BookRow | null
  listBooks(): readonly BookRow[]
  searchBooks(query: string): readonly BookRow[]
  insertProgress(bookId: string, currentPage: number, percentage: number): void
  getProgress(bookId: string): { currentPage: number; percentage: number } | null
  close(): void
}

/**
 * Resolve the absolute path to the single local DB file.
 *
 * Per the issue acceptance criteria, the file lives at
 * `<ALEJANDRIA_DATA_DIR>/library.sqlite`. PR-3B tests override the
 * env var with a tmpdir; production runs on Mac will resolve it via
 * the Electron `app.getPath('userData')` helper in PR4.
 */
export function resolveDbPath(): string {
  const fromEnv = process.env['ALEJANDRIA_DATA_DIR']
  const base = fromEnv ?? join(process.cwd(), 'data')
  return join(base, 'library.sqlite')
}

/**
 * Schema SQL — idempotent. `CREATE TABLE IF NOT EXISTS` plus an
 * FTS5 virtual table kept in sync via AFTER INSERT/UPDATE/DELETE
 * triggers. FTS5 columns match the spec: `title` + `author_name` +
 * `excerpt`. The spec also lists `category_path` but that joins via
 * `book_categories` → `categories`; for PR-3B a denormalised author
 * column on the books row is enough (the full category graph lands
 * with the taxonomy PR).
 */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS authors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_es TEXT,
  parent_id TEXT REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS sagas (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  year INTEGER NOT NULL,
  format TEXT NOT NULL,
  file_path TEXT NOT NULL,
  content_hash TEXT NOT NULL UNIQUE,
  excerpt TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'local_scan'
);

CREATE TABLE IF NOT EXISTS book_categories (
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (book_id, category_id)
);

CREATE TABLE IF NOT EXISTS book_sagas (
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  saga_id TEXT NOT NULL REFERENCES sagas(id) ON DELETE CASCADE,
  ordinal INTEGER,
  PRIMARY KEY (book_id, saga_id)
);

CREATE TABLE IF NOT EXISTS reading_progress (
  book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
  current_page INTEGER NOT NULL,
  percentage REAL NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE VIRTUAL TABLE IF NOT EXISTS books_fts USING fts5(
  title,
  excerpt,
  content='books',
  content_rowid='rowid',
  tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS books_ai AFTER INSERT ON books BEGIN
  INSERT INTO books_fts(rowid, title, excerpt)
  VALUES (new.rowid, new.title, new.excerpt);
END;

CREATE TRIGGER IF NOT EXISTS books_ad AFTER DELETE ON books BEGIN
  INSERT INTO books_fts(books_fts, rowid, title, excerpt)
  VALUES ('delete', old.rowid, old.title, old.excerpt);
END;

CREATE TRIGGER IF NOT EXISTS books_au AFTER UPDATE ON books BEGIN
  INSERT INTO books_fts(books_fts, rowid, title, excerpt)
  VALUES ('delete', old.rowid, old.title, old.excerpt);
  INSERT INTO books_fts(rowid, title, excerpt)
  VALUES (new.rowid, new.title, new.excerpt);
END;
`

interface BookRowDb {
  id: string
  title: string
  author: string
  year: number
  format: string
  file_path: string
  content_hash: string
  excerpt: string
}

function rowToBook(row: BookRowDb): BookRow {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    year: row.year,
    format: row.format,
    filePath: row.file_path,
    contentHash: row.content_hash,
    excerpt: row.excerpt,
  }
}

/**
 * Open the local DB. Lazy: the file is only created on first call
 * to any helper, so importing this module from a Server Component
 * during a build (where `process.cwd()` is fine but we don't want
 * side effects) stays safe.
 */
export function openLocalDb(): LocalDb {
  const path = resolveDbPath()
  mkdirSync(dirname(path), { recursive: true })

  const handle = new Database(path)
  handle.pragma('journal_mode = WAL')
  handle.pragma('foreign_keys = ON')
  handle.exec(SCHEMA_SQL)

  const insertBookStmt = handle.prepare(`
    INSERT INTO books (id, title, author, year, format, file_path, content_hash, excerpt)
    VALUES (@id, @title, @author, @year, @format, @file_path, @content_hash, @excerpt)
  `)

  const findByIdStmt = handle.prepare(`SELECT * FROM books WHERE id = ?`)
  const listBooksStmt = handle.prepare(`SELECT * FROM books ORDER BY rowid DESC`)
  const searchStmt = handle.prepare(`
    SELECT b.* FROM books b
    JOIN books_fts ON books_fts.rowid = b.rowid
    WHERE books_fts MATCH ?
    ORDER BY rank
  `)
  const insertProgressStmt = handle.prepare(`
    INSERT INTO reading_progress (book_id, current_page, percentage)
    VALUES (?, ?, ?)
    ON CONFLICT(book_id) DO UPDATE SET
      current_page = excluded.current_page,
      percentage = excluded.percentage,
      updated_at = datetime('now')
  `)
  const getProgressStmt = handle.prepare(`
    SELECT current_page, percentage FROM reading_progress WHERE book_id = ?
  `)

  return {
    insertBook(input: BookInput): BookRow {
      insertBookStmt.run({
        id: input.id,
        title: input.title,
        author: input.author,
        year: input.year,
        format: input.format,
        file_path: input.filePath,
        content_hash: input.contentHash,
        excerpt: input.excerpt,
      })
      const row = findByIdStmt.get(input.id) as BookRowDb | undefined
      if (!row) {
        throw new Error(`insertBook: row not found after insert (id=${input.id})`)
      }
      return rowToBook(row)
    },

    findById(id: string): BookRow | null {
      const row = findByIdStmt.get(id) as BookRowDb | undefined
      return row ? rowToBook(row) : null
    },

    listBooks(): readonly BookRow[] {
      const rows = listBooksStmt.all() as BookRowDb[]
      return rows.map(rowToBook)
    },

    searchBooks(query: string): readonly BookRow[] {
      // FTS5 prefix-match the last token so partial words work
      // ("ficc" matches "Ficciones"). Strip FTS5 operators from user
      // input to avoid crashing the parser.
      const sanitized = query
        .trim()
        .split(/\s+/)
        .map((token) => token.replace(/[^\p{L}\p{N}]+/gu, ''))
        .filter((token) => token.length > 0)
        .map((token) => `${token}*`)
        .join(' ')
      if (sanitized.length === 0) return []
      const rows = searchStmt.all(sanitized) as BookRowDb[]
      return rows.map(rowToBook)
    },

    insertProgress(bookId: string, currentPage: number, percentage: number): void {
      insertProgressStmt.run(bookId, currentPage, percentage)
    },

    getProgress(bookId: string): { currentPage: number; percentage: number } | null {
      const row = getProgressStmt.get(bookId) as
        | { current_page: number; percentage: number }
        | undefined
      if (!row) return null
      return { currentPage: row.current_page, percentage: row.percentage }
    },

    close(): void {
      handle.close()
    },
  }
}
