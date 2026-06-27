import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  BookDetailDto,
  BooksService,
  ListBooksQuery,
  ListBooksResponse,
} from './books.service';

/**
 * Query DTO for ``GET /api/books``.
 *
 * Snake-case aliases (``author_id``) match the rest of the API; the
 * pipe auto-converts the parsed primitives into the corresponding
 * fields on {@link ListBooksQuery}.
 */
class ListBooksQueryDto implements ListBooksQuery {
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

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  author_id?: number;

  @IsOptional()
  @IsString()
  format?: string;

  @IsOptional()
  @IsString()
  language?: string;
}

/**
 * Catalog HTTP routes — PR-2D, work unit 1.
 *
 *   GET /api/books           → BooksService.listBooks
 *   GET /api/books/:id       → BooksService.getBookDetail
 *
 * Both routes are protected by ``JwtAuthGuard``; the guard was
 * introduced in PR-2C and is re-exported by ``AuthModule``.
 */
@Controller({ path: 'api/books', version: undefined })
@UseGuards(JwtAuthGuard)
export class BooksController {
  constructor(private readonly booksService: BooksService) {}

  @Get()
  list(@Query() query: ListBooksQueryDto): Promise<ListBooksResponse> {
    return this.booksService.listBooks(query);
  }

  @Get(':id')
  detail(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<BookDetailDto> {
    return this.booksService.getBookDetail(id);
  }
}