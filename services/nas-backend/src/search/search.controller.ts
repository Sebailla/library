import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SearchQuery, SearchResponse, SearchService } from './search.service';

/**
 * Whitelist regex for ``SearchQueryDto.q`` — 4R review #39.
 *
 * Accepts the printable subset that's actually meaningful for a book
 * catalog: letters (any script), digits, whitespace, and a small set
 * of punctuation commonly seen in titles (``-_.:,;'"!?``) or ISBNs
 * (``-/X``). Everything else — control bytes, NULs, SQL meta-
 * characters, brackets, backticks, slashes — is rejected by the
 * guard BEFORE it reaches the pgroonga query builder, so a hostile
 * client cannot probe the index for injection nor pad the query
 * string into something expensive to score.
 *
 * The pattern requires at least one non-whitespace character via
 * the lookahead ``(?=.*\p{L}|\p{N})`` — a string made entirely of
 * spaces or punctuation would otherwise pass the character class
 * alone. The full string is anchored (``^`` + ``$``) so a single
 * out-of-band byte anywhere in the payload is enough to fail.
 */
const SEARCH_QUERY_PATTERN =
  /^(?=.*[\p{L}\p{N}])[\p{L}\p{N}\s\-_.,:;'"!?()&+]+$/u;

/**
 * Maximum length for ``SearchQueryDto.q`` — 4R review #39.
 *
 * 256 chars is enough for any natural-language book title, any
 * author name, any ISBN, and any reasonable Spanish + Japanese
 * mixed-language query. Anything longer is almost certainly a
 * probing attempt or a runaway client. Capping here protects the
 * pgroonga parser from having to tokenise arbitrarily long input
 * on every request.
 */
const SEARCH_QUERY_MAX_LENGTH = 256;

/** Query DTO for ``GET /api/search``. */
class SearchQueryDto implements SearchQuery {
  @IsString()
  @IsNotEmpty()
  @MaxLength(SEARCH_QUERY_MAX_LENGTH)
  @Matches(SEARCH_QUERY_PATTERN, {
    message: `q must match ${SEARCH_QUERY_PATTERN} and be ≤ ${SEARCH_QUERY_MAX_LENGTH} chars`,
  })
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