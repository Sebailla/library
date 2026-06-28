import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { DatabaseModule, PG_POOL_TOKEN } from '../database/database.module';
import { HealthController } from './health.controller';
import { HealthService, PingFn } from './health.service';

/**
 * Wires ``GET /health`` against real Postgres + Redis clients.
 *
 * Both ping functions are exported as injectable string tokens
 * (``DATABASE_PING``, ``REDIS_PING``) so e2e tests can override them
 * to simulate outage scenarios without touching the real network.
 *
 * 4R review #40 — PG_POOL is NOT redefined here. ``HealthModule``
 * imports ``DatabaseModule`` and re-uses the singleton pool it
 * registers. Before this fix the module declared its own
 * ``PG_POOL`` provider with a hard-coded localhost URL, opening a
 * SECOND ``pg.Pool`` against the same database and shadowing
 * ``DatabaseModule``'s provider in the AppModule DI graph.
 *
 * The Redis client is local to this module because no other
 * feature owns it yet (BullMQ workers import ``ioredis`` directly
 * via ``buildRedis()`` so there is no shared module to import).
 *
 * Both ping providers are kept as injectable string tokens so
 * tests can override them with a stub without touching real
 * network clients.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [HealthController],
  providers: [
    HealthService,
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
      inject: [PG_POOL_TOKEN],
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
