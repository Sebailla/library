import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';

/**
 * Root NestJS module for the NAS backend.
 *
 * PR-2A wires only the ``HealthModule`` so the application can boot,
 * respond to ``GET /health``, and verify DB + Redis connectivity.
 * Additional modules land in chained PRs:
 *
 * - PR-2B: ``DatabaseModule`` + initial migration
 * - PR-2C: ``AuthModule`` + device pairing
 * - PR-2D: ``BooksModule`` + ``SearchModule``
 * - PR-2E: ``DownloadsModule`` + ``WorkersModule`` (BullMQ)
 * - PR-2F: ``DiscoveryModule`` (mDNS + Tailscale)
 */
@Module({
  imports: [HealthModule],
})
export class AppModule {}
