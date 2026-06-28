import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { MeModule } from './me/me.module';
import { BooksModule } from './books/books.module';
import { AuthorsModule } from './authors/authors.module';
import { SearchModule } from './search/search.module';
import { DownloadsModule } from './downloads/downloads.module';
import { WorkersModule } from './workers/workers.module';
import { DiscoveryModule } from './discovery/discovery.module';

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
 * routes), ``AuthorsModule`` (author index), and ``SearchModule``
 * (pgroonga-backed full-text search), all behind the
 * ``JwtAuthGuard`` introduced in PR-2C.
 *
 * PR-2E adds the ``DownloadsModule`` (HTTP routes for
 * ``/api/downloads``) and the ``WorkersModule`` (BullMQ + sidecar
 * spawn). The workers module gracefully no-ops when Redis is
 * down so the rest of the API keeps serving traffic.
 *
 * PR-2F adds the ``DiscoveryModule`` which exposes the public
 * ``GET /api/discovery/info`` endpoint. The endpoint is open (no
 * ``JwtAuthGuard``) because clients need it BEFORE they have a
 * bearer token; it returns the mDNS service name, HTTP port,
 * Tailscale IPv4 (or ``null``), and the host's LAN IPv4 list.
 */
@Module({
  imports: [
    DatabaseModule,
    HealthModule,
    AuthModule,
    MeModule,
    BooksModule,
    AuthorsModule,
    SearchModule,
    DownloadsModule,
    WorkersModule,
    DiscoveryModule,
  ],
})
export class AppModule {}
