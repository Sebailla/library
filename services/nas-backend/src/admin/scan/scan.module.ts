import { Module, forwardRef } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Pool } from 'pg';
import { AuthModule } from '../../auth/auth.module';
import { DatabaseModule } from '../../database/database.module';
import { PG_POOL } from '../../database/pg.service';
import {
  BULLMQ_CONNECTION,
  getScanProducerDefaultJobOptions,
} from '../../workers/bullmq.config';
import { WorkersModule } from '../../workers/workers.module';
import {
  BullMqScanJobProducer,
  ScanJobProducer,
  ScanService,
  SCAN_JOB_PRODUCER,
  SCAN_QUEUE_NAME,
} from './scan.service';
import { ScanEventBus } from './scan-event-bus';
import { ScanController } from './scan.controller';
import {
  SCAN_REPOSITORY,
  PgScanRepository,
} from './scan.repository';

/**
 * Admin scan module — PR-N4.
 *
 * Wires:
 *
 *   - ``ScanRepository``  — pg-backed CRUD over the ``scan_jobs``
 *                            table (migration 016).
 *   - ``ScanService``      — orchestration: persists the row,
 *                            enqueues the BullMQ job, flips the
 *                            cooperative cancel flag.
 *   - ``ScanEventBus``     — per-job topic for SSE progress
 *                            delivery.
 *   - ``ScanController``   — the ``/api/admin/scan/*`` HTTP
 *                            surface (POST/GET/cancel + SSE).
 *
 * The BullMQ producer is built from the shared
 * ``BULLMQ_CONNECTION`` Redis client (see ``bullmq.config.ts``).
 * If the connection is unavailable (Redis genuinely down) the
 * producer stub returns successfully without enqueuing — the
 * ``scan_jobs`` row is still recorded so the admin UI can show
 * "queued" and the worker can re-trigger once Redis recovers.
 *
 * Auth: the controller re-uses ``AuthModule`` for the
 * ``JwtAuthGuard`` + ``DEVICES_REPOSITORY`` (the
 * ``ScanAdminGuard`` needs the latter for the ``isAdmin``
 * check).
 */
@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    // ``WorkersModule`` is imported via ``forwardRef`` so the
    // ``BULLMQ_CONNECTION`` token is reachable without forcing
    // NestJS to resolve the (ScanModule ↔ WorkersModule) cycle
    // eagerly. ``WorkersModule`` also imports ``ScanModule``
    // for the repository + event bus, so the forwardRef pair
    // is what makes the cycle resolve.
    forwardRef(() => WorkersModule),
  ],
  controllers: [ScanController],
  providers: [
    ScanEventBus,
    ScanService,
    {
      provide: SCAN_REPOSITORY,
      inject: [PG_POOL],
      useFactory: (pool: Pool): PgScanRepository => new PgScanRepository(pool),
    },
    {
      // The producer is the only BullMQ-touching piece inside
      // the admin module. When ``BULLMQ_CONNECTION`` is null
      // (test override) we fall back to a no-op stub so the
      // HTTP layer still records the queued row without trying
      // to talk to Redis.
      provide: SCAN_JOB_PRODUCER,
      inject: [BULLMQ_CONNECTION],
      useFactory: (
        connection: import('ioredis').Redis | null,
      ): ScanJobProducer => {
        if (!connection) {
          return {
            async add() {
              /* no-op: Redis is down */
              return null;
            },
            async close() {
              /* no-op */
            },
          };
        }
        const queue = new Queue<{ jobId: string }>(
          SCAN_QUEUE_NAME,
          {
            connection: connection as never,
            // Issue #98 — the producer and the worker share
            // ``buildQueueOptions()`` (re-exported from
            // ``workers.module.ts``) so a retry-budget change
            // picks up both sides; no literal retry values are
            // duplicated here.
            defaultJobOptions: getScanProducerDefaultJobOptions(),
          },
        );
        return new BullMqScanJobProducer(queue);
      },
    },
  ],
  exports: [ScanService, SCAN_REPOSITORY, SCAN_JOB_PRODUCER, ScanEventBus],
})
export class ScanModule {}