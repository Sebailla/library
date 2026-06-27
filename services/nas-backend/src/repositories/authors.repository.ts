import { Pool, PoolClient } from 'pg';
import { buildPool } from '../database/pg.service';

/**
 * Shape of a row in the ``authors`` table.
 *
 * Column names mirror the SQL definition in
 * ``migrations/002_authors.sql``.
 */
export interface Author {
  id: number;
  lastname: string;
  firstname: string;
  createdAt: Date;
}

/** Subset of {@link Author} accepted by ``insert``. */
export interface NewAuthor {
  lastname: string;
  firstname: string;
}

/** Pagination options for {@link AuthorsRepository.list}. */
export interface AuthorsListOpts {
  limit?: number;
  offset?: number;
}

/** Repository contract for the ``authors`` table. */
export interface AuthorsRepository {
  insert(author: NewAuthor): Promise<Author>;
  findById(id: number): Promise<Author | null>;
  list(opts?: AuthorsListOpts): Promise<Author[]>;
  count(): Promise<number>;
  close(): Promise<void>;
}

interface AuthorRow {
  id: string | number;
  lastname: string;
  firstname: string;
  created_at: Date;
}

function rowToAuthor(row: AuthorRow): Author {
  return {
    id: Number(row.id),
    lastname: row.lastname,
    firstname: row.firstname,
    createdAt: row.created_at,
  };
}

const COLUMNS = 'id, lastname, firstname, created_at';

/**
 * pg-backed implementation of {@link AuthorsRepository}. Use
 * {@link createAuthorsRepository} to instantiate it.
 */
export class PgAuthorsRepository implements AuthorsRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async insert(author: NewAuthor): Promise<Author> {
    const sql = `
      INSERT INTO authors (lastname, firstname)
      VALUES ($1, $2)
      RETURNING ${COLUMNS}
    `;
    const client: PoolClient = await this.pool.connect();
    try {
      const res = await client.query<AuthorRow>(sql, [
        author.lastname,
        author.firstname,
      ]);
      return rowToAuthor(res.rows[0]);
    } finally {
      client.release();
    }
  }

  async findById(id: number): Promise<Author | null> {
    const res = await this.pool.query<AuthorRow>(
      `SELECT ${COLUMNS} FROM authors WHERE id = $1`,
      [id],
    );
    if (res.rowCount === 0) return null;
    return rowToAuthor(res.rows[0]);
  }

  async list(opts: AuthorsListOpts = {}): Promise<Author[]> {
    const limit = opts.limit ?? 20;
    const offset = opts.offset ?? 0;
    const res = await this.pool.query<AuthorRow>(
      `SELECT ${COLUMNS} FROM authors ORDER BY id ASC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return res.rows.map(rowToAuthor);
  }

  async count(): Promise<number> {
    const res = await this.pool.query<{ count: string }>(
      'SELECT COUNT(*)::int AS count FROM authors',
    );
    return Number(res.rows[0].count);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export interface CreateAuthorsRepositoryOptions {
  connectionString?: string;
  pool?: Pool;
}

/**
 * Factory used by tests and the NestJS container. Accepts an
 * already-built pool (production wiring) or a connection string
 * (test convenience).
 */
export function createAuthorsRepository(
  options: CreateAuthorsRepositoryOptions = {},
): AuthorsRepository {
  const pool = options.pool ?? buildPool(options.connectionString);
  return new PgAuthorsRepository(pool);
}