import { Pool, PoolClient } from 'pg';
import { buildPool } from '../database/pg.service';

/**
 * Shape of a row in the ``books`` table.
 *
 * Column names mirror the SQL definition in
 * ``migrations/003_books.sql``. Date columns are returned as
 * JavaScript ``Date`` instances because that is what ``pg`` produces
 * for ``TIMESTAMPTZ`` values.
 */
export interface Book {
  id: number;
  title: string;
  authorId: number | null;
  year: number | null;
  language: string | null;
  format: string | null;
  filePath: string;
  fileSizeBytes: number | null;
  contentHash: string | null;
  coverPath: string | null;
  excerpt: string | null;
  indexedAt: Date;
}

/** Subset of ``Book`` used by ``insert``. */
export interface NewBook {
  title: string;
  authorId: number | null;
  year?: number | null;
  language?: string | null;
  format?: string | null;
  filePath: string;
  fileSizeBytes?: number | null;
  contentHash?: string | null;
  coverPath?: string | null;
  excerpt?: string | null;
}

/** Pagination options for list / listByAuthor. */
export interface PaginationOpts {
  limit?: number;
  offset?: number;
}

/** Filters supported by {@link BooksRepository.list} and {@link BooksRepository.count}. */
export interface ListFilters {
  authorId?: number;
  format?: string;
  language?: string;
}

/** Repository contract for the ``books`` table. */
export interface BooksRepository {
  insert(book: NewBook): Promise<Book>;
  findById(id: number): Promise<Book | null>;
  listByAuthor(authorId: number, opts?: PaginationOpts): Promise<Book[]>;
  list(opts?: PaginationOpts & ListFilters): Promise<Book[]>;
  count(filters?: ListFilters): Promise<number>;
  search(query: string, opts?: PaginationOpts): Promise<Book[]>;
  close(): Promise<void>;
}

interface BookRow {
  id: string | number;
  title: string;
  author_id: string | number | null;
  year: number | null;
  language: string | null;
  format: string | null;
  file_path: string;
  file_size_bytes: string | number | null;
  content_hash: string | null;
  cover_path: string | null;
  excerpt: string | null;
  indexed_at: Date;
}

function rowToBook(row: BookRow): Book {
  return {
    id: Number(row.id),
    title: row.title,
    authorId: row.author_id === null ? null : Number(row.author_id),
    year: row.year,
    language: row.language,
    format: row.format,
    filePath: row.file_path,
    fileSizeBytes:
      row.file_size_bytes === null ? null : Number(row.file_size_bytes),
    contentHash: row.content_hash,
    coverPath: row.cover_path,
    excerpt: row.excerpt,
    indexedAt: row.indexed_at,
  };
}

const COLUMNS =
  'id, title, author_id, year, language, format, file_path, file_size_bytes, content_hash, cover_path, excerpt, indexed_at';

/**
 * pg-backed implementation of {@link BooksRepository}. Use
 * {@link createBooksRepository} to instantiate it.
 */
export class PgBooksRepository implements BooksRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async insert(book: NewBook): Promise<Book> {
    const sql = `
      INSERT INTO books (
        title, author_id, year, language, format, file_path,
        file_size_bytes, content_hash, cover_path, excerpt
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING ${COLUMNS}
    `;
    const params = [
      book.title,
      book.authorId,
      book.year ?? null,
      book.language ?? null,
      book.format ?? null,
      book.filePath,
      book.fileSizeBytes ?? null,
      book.contentHash ?? null,
      book.coverPath ?? null,
      book.excerpt ?? null,
    ];
    const client: PoolClient = await this.pool.connect();
    try {
      const res = await client.query<BookRow>(sql, params);
      return rowToBook(res.rows[0]);
    } finally {
      client.release();
    }
  }

  async findById(id: number): Promise<Book | null> {
    const res = await this.pool.query<BookRow>(
      `SELECT ${COLUMNS} FROM books WHERE id = $1`,
      [id],
    );
    if (res.rowCount === 0) return null;
    return rowToBook(res.rows[0]);
  }

  async listByAuthor(
    authorId: number,
    opts: PaginationOpts = {},
  ): Promise<Book[]> {
    return this.runList(
      `SELECT ${COLUMNS} FROM books WHERE author_id = $1 ORDER BY id ASC`,
      [authorId],
      opts,
    );
  }

  async list(opts: PaginationOpts & ListFilters = {}): Promise<Book[]> {
    const { authorId, format, language, ...pagination } = opts;
    const where: string[] = [];
    const params: unknown[] = [];
    if (authorId !== undefined) {
      params.push(authorId);
      where.push(`author_id = $${params.length}`);
    }
    if (format !== undefined) {
      params.push(format);
      where.push(`format = $${params.length}`);
    }
    if (language !== undefined) {
      params.push(language);
      where.push(`language = $${params.length}`);
    }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    return this.runList(
      `SELECT ${COLUMNS} FROM books ${whereClause} ORDER BY id ASC`,
      params,
      pagination,
    );
  }

  async count(filters: ListFilters = {}): Promise<number> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filters.authorId !== undefined) {
      params.push(filters.authorId);
      where.push(`author_id = $${params.length}`);
    }
    if (filters.format !== undefined) {
      params.push(filters.format);
      where.push(`format = $${params.length}`);
    }
    if (filters.language !== undefined) {
      params.push(filters.language);
      where.push(`language = $${params.length}`);
    }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const res = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM books ${whereClause}`,
      params,
    );
    return Number(res.rows[0].count);
  }

  async search(
    query: string,
    opts: PaginationOpts = {},
  ): Promise<Book[]> {
    // pgroonga full-text search via the ``&@~`` operator. When the
    // pgroonga index has not been created yet (e.g. during early
    // tests before migration 008 runs), this still executes but may
    // fall back to a sequential scan. The repository tests cover the
    // happy path; the migration 008 commit introduces the index.
    return this.runList(
      `SELECT ${COLUMNS} FROM books WHERE title &@~ $1 ORDER BY id ASC`,
      [query],
      opts,
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async runList(
    sql: string,
    baseParams: ReadonlyArray<unknown>,
    opts: PaginationOpts,
  ): Promise<Book[]> {
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;
    const finalSql = `${sql} LIMIT $${baseParams.length + 1} OFFSET $${baseParams.length + 2}`;
    const res = await this.pool.query<BookRow>(finalSql, [
      ...baseParams,
      limit,
      offset,
    ]);
    return res.rows.map(rowToBook);
  }
}

export interface CreateBooksRepositoryOptions {
  connectionString?: string;
  pool?: Pool;
}

/**
 * Factory used by tests and the NestJS container. Accepts an
 * already-built pool (production wiring) or a connection string
 * (test convenience).
 */
export function createBooksRepository(
  options: CreateBooksRepositoryOptions = {},
): BooksRepository {
  const pool = options.pool ?? buildPool(options.connectionString);
  return new PgBooksRepository(pool);
}