import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { PG_POOL } from '../database/pg.service';
import {
  INSTRUMENTED_DOWNLOADS_SERVICE,
  instrumentDownloadsService,
} from '../observability/downloads-instrumentation';
import { METRICS_SERVICE, MetricsService } from '../observability/metrics.service';
import { ObservabilityModule } from '../observability/observability.module';
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
 * PR-N7 (issue #92, #99) — observability: ``DownloadsService`` is
 * exposed under the ``INSTRUMENTED_DOWNLOADS_SERVICE`` token so
 * the controller can resolve the metric-instrumenting wrapper
 * directly. The ``INSTRUMENTED_DOWNLOADS_SERVICE`` factory closes
 * over the bare ``DownloadsService`` and the
 * ``METRICS_SERVICE`` so the counter increments happen at the
 * controller boundary. Issue #99 makes this wiring mandatory —
 * without it the inline ``recordDownload`` calls were dead-on-
 * arrival and the ``state=\"failed\"`` series stayed at zero.
 *
 * Auth is re-used from ``AuthModule`` so the controllers can apply
 * the ``JwtAuthGuard`` directly.
 */
@Module({
  imports: [AuthModule, DatabaseModule, ObservabilityModule],
  controllers: [DownloadsController],
  providers: [
    DownloadsService,
    {
      provide: DOWNLOADS_REPOSITORY,
      inject: [PG_POOL],
      useFactory: (pool: Pool) => new PgDownloadsRepository(pool),
    },
    {
      provide: INSTRUMENTED_DOWNLOADS_SERVICE,
      inject: [DownloadsService, METRICS_SERVICE],
      useFactory: (
        downloadsService: DownloadsService,
        metrics: MetricsService,
      ) => instrumentDownloadsService(downloadsService, metrics),
    },
  ],
  exports: [
    DOWNLOADS_REPOSITORY,
    DownloadsService,
    INSTRUMENTED_DOWNLOADS_SERVICE,
  ],
})
export class DownloadsModule {}
