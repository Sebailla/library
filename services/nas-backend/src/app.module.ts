import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { MeModule } from './me/me.module';
import { BooksModule } from './books/books.module';
import { AuthorsModule } from './authors/authors.module';

/**
 * Root NestJS module for the NAS backend.
 *
 * PR-2A wired only the ``HealthModule`` so the application could
 * boot, respond to ``GET /health``, and verify DB + Redis
 * connectivity. PR-2B adds the ``DatabaseModule`` so the pool is
 * shared with future repositories (books, categories, sagas,
 * downloads). PR-2C adds the ``AuthModule`` which exposes
 * ``POST /api/auth/pair`` and ``POST /api/auth/refresh`` against
 * the shared ``pg.Pool``. PR-2D adds ``BooksModule`` (catalog
 * routes) and ``AuthorsModule`` (author index routes), both
 * behind the ``JwtAuthGuard`` introduced in PR-2C.
 *
 * Additional modules land in chained PRs:
 *
 * - PR-2D (cont.): ``SearchModule`` (pgroonga-backed ``/api/search``)
 * - PR-2E: ``DownloadsModule`` + ``WorkersModule`` (BullMQ)
 * - PR-2F: ``DiscoveryModule`` (mDNS + Tailscale)
 */
@Module({
  imports: [
    DatabaseModule,
    HealthModule,
    AuthModule,
    MeModule,
    BooksModule,
    AuthorsModule,
  ],
})
export class AppModule {}
