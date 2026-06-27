import { Pool } from 'pg';
import { buildPool } from '../database/pg.service';

/** Shape of a row in the ``sagas`` table. */
export interface Saga {
  id: number;
  name: string;
  authorId: number | null;
  createdAt: Date;
}

/** Subset of {@link Saga} accepted by ``insert``. */
export interface NewSaga {
  name: string;
  authorId: number | null;
}

/** Link between a book and a saga with positional ordering. */
export interface BookSagaLink {
  bookId: number;
  sagaId: number;
  ordinal?: number;
}

interface SagaRow {
  id: string | number;
  name: string;
  author_id: string | number | null;
  created_at: Date;
}

function rowToSaga(row: SagaRow): Saga {
  return {
    id: Number(row.id),
    name: row.name,
    authorId: row.author_id === null ? null : Number(row.author_id),
    createdAt: row.created_at,
  };
}

const COLUMNS = 'id, name, author_id, created_at';

/** Repository contract for the ``sagas`` + ``book_sagas`` tables. */
export interface SagasRepository {
  insert(saga: NewSaga): Promise<Saga>;
  attachBook(link: BookSagaLink): Promise<void>;
  listByAuthor(authorId: number): Promise<Saga[]>;
  listBooksInSaga(sagaId: number): Promise<BookSagaLink[]>;
  close(): Promise<void>;
}

export class PgSagasRepository implements SagasRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async insert(saga: NewSaga): Promise<Saga> {
    const res = await this.pool.query<SagaRow>(
      `INSERT INTO sagas (name, author_id)
       VALUES ($1, $2)
       RETURNING ${COLUMNS}`,
      [saga.name, saga.authorId],
    );
    return rowToSaga(res.rows[0]);
  }

  async attachBook(link: BookSagaLink): Promise<void> {
    // ``ON CONFLICT DO NOTHING`` makes attach idempotent: re-running
    // the same (book_id, saga_id) pair is a no-op instead of an
    // error. The composite primary key on ``book_sagas`` enforces
    // uniqueness; the ``ordinal`` is left at the existing value.
    await this.pool.query(
      `INSERT INTO book_sagas (book_id, saga_id, ordinal)
       VALUES ($1, $2, $3)
       ON CONFLICT (book_id, saga_id) DO NOTHING`,
      [link.bookId, link.sagaId, link.ordinal ?? 0],
    );
  }

  async listByAuthor(authorId: number): Promise<Saga[]> {
    const res = await this.pool.query<SagaRow>(
      `SELECT ${COLUMNS} FROM sagas WHERE author_id = $1 ORDER BY name ASC`,
      [authorId],
    );
    return res.rows.map(rowToSaga);
  }

  async listBooksInSaga(sagaId: number): Promise<BookSagaLink[]> {
    const res = await this.pool.query<{
      book_id: string | number;
      saga_id: string | number;
      ordinal: number;
    }>(
      `SELECT book_id, saga_id, ordinal
       FROM book_sagas
       WHERE saga_id = $1
       ORDER BY ordinal ASC, book_id ASC`,
      [sagaId],
    );
    return res.rows.map((row) => ({
      bookId: Number(row.book_id),
      sagaId: Number(row.saga_id),
      ordinal: row.ordinal,
    }));
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export interface CreateSagasRepositoryOptions {
  connectionString?: string;
  pool?: Pool;
}

export function createSagasRepository(
  options: CreateSagasRepositoryOptions = {},
): SagasRepository {
  const pool = options.pool ?? buildPool(options.connectionString);
  return new PgSagasRepository(pool);
}