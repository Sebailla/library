import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SearchQuery, SearchResponse, SearchService } from './search.service';

/** Query DTO for ``GET /api/search``. */
class SearchQueryDto implements SearchQuery {
  @IsString()
  @IsNotEmpty()
  q!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

/**
 * Search HTTP route — PR-2D, work unit 4.
 *
 *   GET /api/search?q=...&limit=20&offset=0   → SearchService.runSearch
 *
 * Returns books ranked by pgroonga score (descending). Requires a
 * valid Bearer token via ``JwtAuthGuard``.
 */
@Controller({ path: 'api/search', version: undefined })
@UseGuards(JwtAuthGuard)
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  search(@Query() query: SearchQueryDto): Promise<SearchResponse> {
    return this.searchService.runSearch(query);
  }
}