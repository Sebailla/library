import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { AuthModule } from '../auth/auth.module';
import { BooksModule } from '../books/books.module';
import { DatabaseModule } from '../database/database.module';
import { PG_POOL } from '../database/pg.service';
import { AUTHORS_REPOSITORY } from './authors.repository';
import {
  PgAuthorsRepository,
} from '../repositories/authors.repository';
import { AuthorsController } from './authors.controller';
import { AuthorsService } from './authors.service';

/**
 * Authors module — HTTP routes for browsing the author index.
 *
 * Imports ``BooksModule`` so the author detail route can list the
 * books written by the requested author via the
 * ``BOOKS_REPOSITORY`` token (re-exported by ``BooksModule``).
 *
 * ``AUTHORS_REPOSITORY`` is a string token bound to the pg-backed
 * implementation in production; tests override it with an
 * in-memory stub.
 */
@Module({
  imports: [AuthModule, DatabaseModule, BooksModule],
  controllers: [AuthorsController],
  providers: [
    AuthorsService,
    {
      provide: AUTHORS_REPOSITORY,
      inject: [PG_POOL],
      useFactory: (pool: Pool) => new PgAuthorsRepository(pool),
    },
  ],
})
export class AuthorsModule {}