import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { PG_POOL } from '../database/pg.service';
import { DownloadsController } from './downloads.controller';
import {
  DOWNLOADS_REPOSITORY,
  PgDownloadsRepository,
} from './downloads.repository';
import { DownloadsService } from './downloads.service';

/**
 * Downloads module — HTTP routes for the ``/api/downloads`` family
 * (PR-2E, work unit 1, extended PR-N3).
 *
 * Wires ``DownloadsRepository`` (backed by ``PgDownloadsRepository``
 * in production; stubbed via the ``DOWNLOADS_REPOSITORY`` string
 * token in e2e tests) into ``DownloadsService``, which exposes the
 * idempotency-aware ``createDownload`` path and the
 * partial-update / aggregation endpoints.
 *
 * The controller also injects ``DEVICES_REPOSITORY`` so the PR-N3
 * admin gate on ``/stats`` and ``/by-book/:book_id`` can branch
 * on ``devices.is_admin`` (migration 015) without going through
 * the ``JwtAuthGuard`` (which only resolves the bearer, not the
 * role).
 *
 * Auth is re-used from ``AuthModule`` so the controllers can apply
 * the ``JwtAuthGuard`` directly.
 */
@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [DownloadsController],
  providers: [
    DownloadsService,
    {
      provide: DOWNLOADS_REPOSITORY,
      inject: [PG_POOL],
      useFactory: (pool: Pool) => new PgDownloadsRepository(pool),
    },
  ],
  exports: [DOWNLOADS_REPOSITORY],
})
export class DownloadsModule {}
