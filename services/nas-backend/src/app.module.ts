import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerException, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
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
import { FilesModule } from './files/files.module';
import { LibrariesModule } from './libraries/libraries.module';
import { ScanModule } from './admin/scan/scan.module';
import { OrganizeModule } from './admin/organize/organize.module';

/**
 * Reshape {@link ThrottlerException} into the project's standard
 * ``{ error: { code, message } }`` envelope so the 4R-review
 * contract (#34) is satisfied: clients can branch on a stable
 * ``code === 'THROTTLED'`` the same way they already do for
 * ``BAD_PIN``, ``TOKEN_INVALID``, etc.
 */
@Catch(ThrottlerException)
class ThrottlerExceptionFilter implements ExceptionFilter {
  catch(exception: ThrottlerException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const status = exception.getStatus();
    response.status(status).json({
      error: {
        code: 'THROTTLED',
        message: exception.message,
      },
    });
  }
}

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
 *
 * PR-N1 adds the ``FilesModule`` which exposes the
 * ``GET /api/files/:book_id`` and ``HEAD /api/files/:book_id``
 * endpoints used to stream book files with HTTP Range support.
 * The module is read-only against the books table and reuses
 * ``BOOKS_REPOSITORY`` so the path validation can look up
 * ``books.file_path`` without a second DB connection.
 *
 * PR-N2 adds the ``LibrariesModule`` which exposes the
 * ``/api/libraries`` HTTP surface — CRUD over the
 * ``libraries`` table, per-device active library activation,
 * and creator-only authorisation for PATCH / DELETE. The
 * module imports ``BooksModule`` so the
 * ``LIBRARY_BOOK_COUNT`` adapter can call
 * ``BOOKS_REPOSITORY.countByLibrary`` to enforce the
 * "refuse DELETE when books are indexed" rule.
 *
 * PR-N4 adds the ``ScanModule`` which exposes the
 * ``/api/admin/scan/*`` HTTP surface — admin-only full /
 * incremental scan enqueue, status listing, cooperative
 * cancellation, and SSE progress streaming. The module is gated
 * by ``JwtAuthGuard`` + ``ScanAdminGuard`` so only paired devices
 * with ``is_admin = true`` (migration 015) can trigger a scan.
 *
 * PR-N5 adds the ``OrganizeModule`` which exposes the
 * ``/api/admin/organize/*`` HTTP surface — admin-only analyze
 * (proposed paths for a folder) and execute (idempotent
 * fs.rename with skip-on-target-exists semantics). Reuses the
 * same ``ScanAdminGuard`` so the same role escalation applies.
 *
 * Rate limiting (#34, 4R review): ``ThrottlerModule`` is
 * registered with three named buckets (see ``throttlers`` array
 * below) and the ``ThrottlerGuard`` is bound as a global APP_GUARD
 * so every route is subject to its limits unless it overrides
 * with ``@Throttle({ default: { limit, ttl } })``.
 */
@Module({
  imports: [
    ThrottlerModule.forRoot({
      // Default floor (60 req / 60s) so every route is rate-
      // limited even before the per-route @Throttle decorator
      // kicks in. Routes that need a tighter limit (auth pair,
      // auth refresh) override via the decorator on the
      // controller method; discovery/info accepts the default.
      throttlers: [
        {
          name: 'default',
          limit: 60,
          ttl: 60_000,
        },
      ],
      errorMessage: 'Too many requests, please try again later.',
    }),
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
    FilesModule,
    LibrariesModule,
    ScanModule,
    OrganizeModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_FILTER,
      useClass: ThrottlerExceptionFilter,
    },
  ],
})
export class AppModule {}
