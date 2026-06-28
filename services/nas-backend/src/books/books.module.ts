import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { PG_POOL } from '../database/pg.service';
import {
  PgBooksRepository,
  BOOKS_REPOSITORY,
} from './books.repository';
import {
  PgCategoriesRepository,
  CATEGORIES_REPOSITORY,
} from './categories.repository';
import {
  PgSagasRepository,
  SAGAS_REPOSITORY,
} from './sagas.repository';
import { BooksController } from './books.controller';
import { BooksService } from './books.service';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';

/**
 * Catalog module — HTTP routes for browsing the library.
 *
 * Wires three repositories (books, categories, sagas) into the
 * ``BooksService`` (which backs ``/api/books`` and
 * ``/api/books/:id``) and ``CategoriesService`` (which backs
 * ``/api/categories``). Auth is imported from ``AuthModule`` so
 * the ``JwtAuthGuard`` is reusable; the controllers apply it
 * directly via ``@UseGuards``.
 *
 * Each repository is exposed via a string token
 * (``BOOKS_REPOSITORY``, ``CATEGORIES_REPOSITORY``,
 * ``SAGAS_REPOSITORY``) so e2e tests can override the
 * implementation with in-memory stubs.
 */
@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [BooksController, CategoriesController],
  providers: [
    BooksService,
    CategoriesService,
    {
      provide: BOOKS_REPOSITORY,
      inject: [PG_POOL],
      useFactory: (pool: Pool) => new PgBooksRepository(pool),
    },
    {
      provide: CATEGORIES_REPOSITORY,
      inject: [PG_POOL],
      useFactory: (pool: Pool) => new PgCategoriesRepository(pool),
    },
    {
      provide: SAGAS_REPOSITORY,
      inject: [PG_POOL],
      useFactory: (pool: Pool) => new PgSagasRepository(pool),
    },
  ],
  // ``BOOKS_REPOSITORY`` is re-exported so sibling modules
  // (currently ``AuthorsModule``) can resolve it without re-wiring
  // the pg pool. ``CATEGORIES_REPOSITORY`` and ``SAGAS_REPOSITORY``
  // stay internal — only the services in this module use them.
  exports: [BOOKS_REPOSITORY],
})
export class BooksModule {}