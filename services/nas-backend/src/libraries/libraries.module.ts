import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { PG_POOL } from '../database/pg.service';
import { BooksModule } from '../books/books.module';
import {
  PgLibrariesRepository,
  LIBRARIES_REPOSITORY,
} from './libraries.repository';
import { LibrariesService } from './libraries.service';
import { LibrariesController } from './libraries.controller';
import {
  PgDeviceLookupAdapter,
  PgLibraryBookCountAdapter,
} from './libraries.adapters';
import {
  DEVICES_LOOKUP,
  LIBRARY_BOOK_COUNT,
} from './libraries.service';

/**
 * Multi-library module — PR-N2.
 *
 * Wires the libraries HTTP surface (``/api/libraries``) by
 * composing three collaborators:
 *
 *   - {@link PgLibrariesRepository} — CRUD + device activation
 *     against the ``libraries`` + ``device_libraries`` tables.
 *   - {@link PgLibraryBookCountAdapter} — bridges the
 *     ``BOOKS_REPOSITORY.countByLibrary`` call to the
 *     narrow {@link LibraryBookCount} seam the service uses.
 *   - {@link PgDeviceLookupAdapter} — bridges the
 *     ``DEVICES_REPOSITORY.findByDeviceId`` call to the
 *     narrow {@link DeviceLookup} seam the service uses.
 *
 * The adapters are declared as their own providers (rather
 * than inline ``useFactory`` objects) so the e2e suite can
 * override them with stubs via
 * ``Test.createTestingModule().overrideProvider()`` without
 * touching the underlying repository tokens.
 *
 * ``BooksModule`` is imported (not just ``BOOKS_REPOSITORY``
 * re-imported) so the books repository provider is in scope
 * for the adapter. ``AuthModule`` is imported so the
 * ``JwtAuthGuard`` is available for ``@UseGuards``.
 */
@Module({
  imports: [AuthModule, DatabaseModule, BooksModule],
  controllers: [LibrariesController],
  providers: [
    LibrariesService,
    {
      provide: LIBRARIES_REPOSITORY,
      inject: [PG_POOL],
      useFactory: (pool: Pool) => new PgLibrariesRepository(pool),
    },
    {
      provide: LIBRARY_BOOK_COUNT,
      useClass: PgLibraryBookCountAdapter,
    },
    {
      provide: DEVICES_LOOKUP,
      useClass: PgDeviceLookupAdapter,
    },
  ],
  // PR-N4 — the admin scan worker (in WorkersModule) needs the
  // libraries repository to resolve ``library.root_path``. The
  // re-export keeps the boundary small without forcing every
  // consumer to import LibrariesModule directly.
  exports: [LIBRARIES_REPOSITORY],
})
export class LibrariesModule {}
