import { Inject, Injectable } from '@nestjs/common';
import {
  SearchHit,
  SEARCH_REPOSITORY,
  SearchRepository,
} from './search.repository';

/** Pagination defaults for ``GET /api/search``. */
const DEFAULT_LIMIT = 20;

/** Query DTO accepted by the search route. */
export interface SearchQuery {
  q: string;
  limit?: number;
  offset?: number;
}

/** Item shape returned by ``GET /api/search``. */
export interface SearchHitDto {
  id: number;
  title: string;
  author_id: number | null;
  score: number;
}

/** Response shape for ``GET /api/search``. */
export interface SearchResponse {
  data: SearchHitDto[];
  query: string;
  limit: number;
  offset: number;
  total: number;
}

/**
 * Search service — backs ``GET /api/search`` via the
 * pgroonga-backed repository.
 *
 * The repository returns rows already ranked by pgroonga score
 * (descending); the service is responsible for clamping the
 * pagination window and projecting the row shape into the public
 * wire format.
 */
@Injectable()
export class SearchService {
  constructor(
    @Inject(SEARCH_REPOSITORY) private readonly search: SearchRepository,
  ) {}

  async runSearch(query: SearchQuery): Promise<SearchResponse> {
    const limit = Math.min(100, Math.max(1, query.limit ?? DEFAULT_LIMIT));
    const offset = Math.max(0, query.offset ?? 0);
    const { rows, total } = await this.search.search(query.q, {
      limit,
      offset,
    });
    return {
      data: rows.map((row: SearchHit) => toHitDto(row)),
      query: query.q,
      limit,
      offset,
      total,
    };
  }
}

function toHitDto(row: SearchHit): SearchHitDto {
  return {
    id: row.id,
    title: row.title,
    author_id: row.authorId,
    score: row.score,
  };
}