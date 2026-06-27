import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  AuthorDetailDto,
  AuthorsService,
  ListAuthorsQuery,
  ListAuthorsResponse,
} from './authors.service';

/** Query DTO for ``GET /api/authors``. */
class ListAuthorsQueryDto implements ListAuthorsQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

/**
 * Author HTTP routes — PR-2D, work unit 2.
 *
 *   GET /api/authors       → AuthorsService.listAuthors
 *   GET /api/authors/:id   → AuthorsService.getAuthorDetail
 *
 * Both routes are protected by ``JwtAuthGuard`` (PR-2C). The
 * detail route cross-references the books repository via the
 * service layer so the controller stays a thin transport adapter.
 */
@Controller({ path: 'api/authors', version: undefined })
@UseGuards(JwtAuthGuard)
export class AuthorsController {
  constructor(private readonly authorsService: AuthorsService) {}

  @Get()
  list(@Query() query: ListAuthorsQueryDto): Promise<ListAuthorsResponse> {
    return this.authorsService.listAuthors(query);
  }

  @Get(':id')
  detail(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<AuthorDetailDto> {
    return this.authorsService.getAuthorDetail(id);
  }
}