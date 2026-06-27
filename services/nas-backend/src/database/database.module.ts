import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { buildPool, PG_POOL, PgService } from './pg.service';

/**
 * Wires ``pg.Pool`` into the NestJS DI graph.
 *
 * The module is intentionally small: it owns the pool and exposes
 * the ``PgService`` for repositories and other modules to inject.
 * ``PG_POOL`` is exposed as a string token so tests can override it
 * with a transient pool.
 */
@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: (): Pool => buildPool(),
    },
    PgService,
  ],
  exports: [PgService, PG_POOL],
})
export class DatabaseModule {}