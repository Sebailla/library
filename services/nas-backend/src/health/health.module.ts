import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { HealthController } from './health.controller';
import { HealthService, PingFn } from './health.service';

/**
 * Wires ``GET /health`` against real Postgres + Redis clients.
 *
 * Both ping functions are exported as injectable string tokens
 * (``DATABASE_PING``, ``REDIS_PING``) so e2e tests can override them
 * to simulate outage scenarios without touching the real network.
 *
 * Real ``pg.Pool`` + ``ioredis`` instances are created lazily here so
 * tests that never bootstrap the module do not open sockets.
 */
@Module({
  controllers: [HealthController],
  providers: [
    HealthService,
    {
      provide: 'PG_POOL',
      useFactory: (): Pool => {
        const connectionString =
          process.env.DATABASE_URL ??
          'postgresql://alejandria:alejandria@localhost:5432/alejandria';
        return new Pool({ connectionString, connectionTimeoutMillis: 1000 });
      },
    },
    {
      provide: 'REDIS_CLIENT',
      useFactory: (): Redis => {
        const host = process.env.REDIS_HOST ?? 'localhost';
        const port = Number(process.env.REDIS_PORT ?? 6379);
        return new Redis({
          host,
          port,
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          connectTimeout: 1000,
          enableOfflineQueue: false,
        });
      },
    },
    {
      provide: 'DATABASE_PING',
      inject: ['PG_POOL'],
      useFactory: (pool: Pool): PingFn => async () => {
        await pool.query('SELECT 1');
      },
    },
    {
      provide: 'REDIS_PING',
      inject: ['REDIS_CLIENT'],
      useFactory: (client: Redis): PingFn => async () => {
        const pong = await client.ping();
        if (pong !== 'PONG') {
          throw new Error(`unexpected redis ping reply: ${pong}`);
        }
      },
    },
  ],
})
export class HealthModule {}
