import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';

/**
 * Root NestJS module for the NAS backend.
 *
 * PR-2A wired only the ``HealthModule`` so the application could
 * boot, respond to ``GET /health``, and verify DB + Redis
 * connectivity. PR-2B adds the ``DatabaseModule`` so the pool is
 * shared with future repositories (books, categories, sagas,
 * downloads). Additional modules land in chained PRs:
 *
 * - PR-2C: ``AuthModule`` + device pairing
 * - PR-2D: ``BooksModule`` + ``SearchModule``
 * - PR-2E: ``DownloadsModule`` + ``WorkersModule`` (BullMQ)
 * - PR-2F: ``DiscoveryModule`` (mDNS + Tailscale)
 */
@Module({
  imports: [DatabaseModule, HealthModule],
})
export class AppModule {}
