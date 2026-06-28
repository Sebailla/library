import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { buildPool, PG_POOL } from '../database/pg.service';

/**
 * Search hit row — a book id + title + authorId + pgroonga score.
 *
 * The ``score`` column is whatever pgroonga returns for the
 * ``&@~`` operator on the ``books_title_pgroonga_idx`` index.
 * pgroonga emits a ``DOUBLE PRECISION`` for that operator so the
 * value can be passed straight through to the HTTP response.
 */
export interface SearchHit {
  id: number;
  title: string;
  authorId: number | null;
  score: number;
}

/** Pagination options for {@link SearchRepository.search}. */
export interface SearchOpts {
  limit?: number;
  offset?: number;
}

/** Repository contract for the pgroonga-backed catalog search. */
export interface SearchRepository {
  /**
   * Run a full-text query against the book catalog. Returns hits
   * ranked by pgroonga score (descending) plus the total number of
   * matches (for pagination metadata).
   */
  search(
    query: string,
    opts?: SearchOpts,
  ): Promise<{ rows: SearchHit[]; total: number }>;
  close(): Promise<void>;
}

interface SearchRow {
  id: string | number;
  title: string;
  author_id: string | number | null;
  score: number | string;
}

function rowToHit(row: SearchRow): SearchHit {
  return {
    id: Number(row.id),
    title: row.title,
    authorId: row.author_id === null ? null : Number(row.author_id),
    score: Number(row.score),
  };
}

/**
 * pg-backed implementation of {@link SearchRepository}.
 *
 * Uses the ``books_title_pgroonga_idx`` index (migration 008) and
 * the ``&@~`` pgroonga operator for relevance ranking. The same
 * index handles Spanish and CJK tokenization out of the box.
 */
export class PgSearchRepository implements SearchRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async search(
    query: string,
    opts: SearchOpts = {},
  ): Promise<{ rows: SearchHit[]; total: number }> {
    const limit = opts.limit ?? 20;
    const offset = opts.offset ?? 0;
    // ``pgroonga.score(tableoid)`` returns the relevance score for
    // each row that matched the ``&@~`` operator. The CTE pattern
    // computes the score once and lets the outer SELECT sort +
    // paginate without re-running pgroonga's scorer.
    const sql = `
      WITH hits AS (
        SELECT id, title, author_id,
               pgroonga.score(books.tableoid) AS score
        FROM books
        WHERE title &@~ $1
      )
      SELECT id, title, author_id, score FROM hits
      ORDER BY score DESC, id ASC
      LIMIT $2 OFFSET $3
    `;
    const rowsRes = await this.pool.query<SearchRow>(sql, [
      query,
      limit,
      offset,
    ]);
    const countRes = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM books WHERE title &@~ $1`,
      [query],
    );
    return {
      rows: rowsRes.rows.map(rowToHit),
      total: Number(countRes.rows[0].count),
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export interface CreateSearchRepositoryOptions {
  connectionString?: string;
  pool?: Pool;
}

/**
 * Factory used by tests and the NestJS container. Accepts an
 * already-built pool (production wiring) or a connection string
 * (test convenience).
 */
export function createSearchRepository(
  options: CreateSearchRepositoryOptions = {},
): SearchRepository {
  const pool = options.pool ?? buildPool(options.connectionString);
  return new PgSearchRepository(pool);
}

/**
 * NestJS provider token for the search repository.
 *
 * Lives in ``src/search/`` (rather than the global
 * ``src/repositories/``) so the search module owns its
 * dependency graph; tests override it with an in-memory stub.
 */
export const SEARCH_REPOSITORY = 'SEARCH_REPOSITORY';

/**
 * Factory used by the ``SearchModule`` to wire
 * {@link PgSearchRepository} against the shared ``pg.Pool``.
 */
export const searchRepositoryProvider = {
  provide: SEARCH_REPOSITORY,
  inject: [PG_POOL],
  useFactory: (pool: Pool): SearchRepository => new PgSearchRepository(pool),
};