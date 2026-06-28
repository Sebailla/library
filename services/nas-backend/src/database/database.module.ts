import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { buildPool, PG_POOL, PgService } from './pg.service';

/**
 * Re-export of the {@link PG_POOL} string token under a module-
 * scoped alias so consumers can ``import { PG_POOL_TOKEN } from
 * '../database/database.module'`` without reaching into the
 * pg.service module just for a string identifier. The two names
 * refer to the SAME provider — switching to either does not
 * change DI resolution.
 *
 * The alias exists because 4R review #40 surfaced a code-smell
 * where HealthModule declared its own ``PG_POOL`` provider.
 * Importing the token by its module source makes the dependency
 * on {@link DatabaseModule} explicit at the call site.
 */
export const PG_POOL_TOKEN = PG_POOL;

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