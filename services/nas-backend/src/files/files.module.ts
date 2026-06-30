import { Module } from '@nestjs/common';
import { BOOKS_REPOSITORY } from '../books/books.repository';
import { AuthModule } from '../auth/auth.module';
import { BooksModule } from '../books/books.module';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';

/**
 * Provider token for the configured library root directory.
 *
 * The token is module-scoped on purpose so the controller can
 * inject it without reaching into a global config service. The
 * default factory pulls ``process.env.NAS_LIBRARY_ROOT`` so the
 * same module can be used in tests (with an override) and in
 * production (with the env var) without rewriting the wiring.
 *
 * Workers PR (`scan.processor`) already uses the same env var;
 * keeping the variable name stable across the backend avoids
 * configuration drift between the HTTP layer and the indexing
 * sidecar.
 */
export const LIBRARY_ROOT = 'LIBRARY_ROOT';

/** Default location of the library on disk when no env var is set. */
export const DEFAULT_LIBRARY_ROOT = '/share/biblioteca/raw';

/**
 * Files module — PR-N1 (NAS backend closure).
 *
 * Wires {@link FilesService} with the shared ``BooksRepository``
 * from {@link BOOKS_REPOSITORY} and exposes {@link FilesController}
 * at ``/api/files``.
 *
 * Imports ``BooksModule`` so the ``BOOKS_REPOSITORY`` provider is
 * available — the files module is intentionally read-only
 * against the books table; it never mutates book rows.
 */
@Module({
  imports: [AuthModule, BooksModule],
  controllers: [FilesController],
  providers: [
    {
      provide: LIBRARY_ROOT,
      useFactory: (): string =>
        process.env.NAS_LIBRARY_ROOT ?? DEFAULT_LIBRARY_ROOT,
    },
    {
      provide: FilesService,
      inject: [BOOKS_REPOSITORY, LIBRARY_ROOT],
      useFactory: (booksRepo: unknown, libraryRoot: string): FilesService =>
        new FilesService(booksRepo as never, libraryRoot),
    },
  ],
  exports: [FilesService, LIBRARY_ROOT],
})
export class FilesModule {}