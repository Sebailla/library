import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { SearchController } from './search.controller';
import {
  SEARCH_REPOSITORY,
  searchRepositoryProvider,
} from './search.repository';
import { SearchService } from './search.service';

/**
 * Search module — pgroonga-backed full-text search over the book
 * catalog.
 *
 * The route ``GET /api/search`` is protected by ``JwtAuthGuard``
 * (PR-2C) and delegates to {@link SearchService}, which in turn
 * reads through the {@link SEARCH_REPOSITORY} provider token. The
 * production wiring binds the token to the pg-backed
 * implementation; tests override it with an in-memory stub.
 */
@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [SearchController],
  providers: [SearchService, searchRepositoryProvider],
  exports: [SEARCH_REPOSITORY],
})
export class SearchModule {}