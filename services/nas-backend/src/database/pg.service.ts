import { Inject, Injectable } from '@nestjs/common';
import { Pool, PoolConfig } from 'pg';

/** Token used to inject a configured ``pg.Pool`` from elsewhere. */
export const PG_POOL = 'PG_POOL';

/**
 * Thin NestJS-friendly wrapper around ``pg.Pool``.
 *
 * The pool is created lazily from ``DATABASE_URL`` (or an explicit
 * factory override). NestJS modules and repositories resolve this
 * service via constructor injection of the ``PG_POOL`` token, which
 * keeps the underlying driver swappable in tests without changing
 * call sites.
 */
@Injectable()
export class PgService {
  private readonly pool: Pool;

  constructor(@Inject(PG_POOL) pool: Pool) {
    this.pool = pool;
  }

  /** Borrow a client from the pool. The caller MUST release it. */
  async getClient(): Promise<Pool['connect'] extends () => infer R ? Awaited<R> : never> {
    return this.pool.connect() as never;
  }

  /** Run a parameterised query against the pool. */
  async query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params: ReadonlyArray<unknown> = [],
  ): Promise<{ rows: R[]; rowCount: number }> {
    const res = await this.pool.query<R>(text, params as unknown[]);
    return { rows: res.rows, rowCount: res.rowCount ?? 0 };
  }

  /** Close the underlying pool. Used in tests and graceful shutdown. */
  async close(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * Build a ``pg.Pool`` from environment variables. Exported so the
 * migration runner and the repositories can reuse it without going
 * through NestJS DI.
 */
export function buildPool(
  connectionString: string = process.env.DATABASE_URL ??
    'postgresql://alejandria:alejandria@localhost:5432/alejandria',
  config: Omit<PoolConfig, 'connectionString'> = {},
): Pool {
  return new Pool({ connectionString, ...config });
}