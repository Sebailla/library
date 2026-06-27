import {
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BOOKS_REPOSITORY,
  BooksRepository,
  ListFilters,
} from './books.repository';
import {
  CATEGORIES_REPOSITORY,
  CategoriesRepository,
} from './categories.repository';
import {
  SAGAS_REPOSITORY,
  SagasRepository,
} from './sagas.repository';

/** Pagination defaults used when the query string omits them. */
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;

/** Pagination request shape (snake_case on the wire). */
export interface ListBooksQuery {
  page?: number;
  limit?: number;
  author_id?: number;
  format?: string;
  language?: string;
}

/** Response shape for ``GET /api/books`` (snake_case on the wire). */
export interface ListBooksResponse {
  data: BookDto[];
  page: number;
  limit: number;
  total: number;
}

/** Item shape returned by ``GET /api/books``. */
export interface BookDto {
  id: number;
  title: string;
  author_id: number | null;
  year: number | null;
  language: string | null;
  format: string | null;
  file_path: string;
  cover_path: string | null;
  excerpt: string | null;
  indexed_at: string;
}

/** Response shape for ``GET /api/books/:id``. */
export interface BookDetailDto extends BookDto {
  file_size_bytes: number | null;
  content_hash: string | null;
  categories: CategorySummaryDto[];
  sagas: SagaSummaryDto[];
}

export interface CategorySummaryDto {
  id: number;
  path: string;
  name_es: string;
  name_en: string;
}

export interface SagaSummaryDto {
  id: number;
  name: string;
  author_id: number | null;
}

/**
 * Catalog service — orchestrates the books, categories, and sagas
 * repositories to build the HTTP responses for the ``/api/books``
 * and ``/api/books/:id`` routes.
 *
 * Pagination defaults to ``page=1`` + ``limit=20`` and is capped at
 * ``limit=100`` to prevent accidental table scans. Filtering accepts
 * ``author_id``, ``format``, and ``language`` (all optional, all
 * combined with AND).
 */
@Injectable()
export class BooksService {
  constructor(
    @Inject(BOOKS_REPOSITORY) private readonly books: BooksRepository,
    @Inject(CATEGORIES_REPOSITORY)
    private readonly categories: CategoriesRepository,
    @Inject(SAGAS_REPOSITORY) private readonly sagas: SagasRepository,
  ) {}

  async listBooks(query: ListBooksQuery): Promise<ListBooksResponse> {
    const page = Math.max(1, query.page ?? DEFAULT_PAGE);
    const limit = Math.min(100, Math.max(1, query.limit ?? DEFAULT_LIMIT));
    const offset = (page - 1) * limit;
    const filters: ListFilters = {
      ...(query.author_id !== undefined ? { authorId: query.author_id } : {}),
      ...(query.format !== undefined ? { format: query.format } : {}),
      ...(query.language !== undefined ? { language: query.language } : {}),
    };
    const [rows, total] = await Promise.all([
      this.books.list({ ...filters, limit, offset }),
      this.books.count(filters),
    ]);
    return {
      data: rows.map(toBookDto),
      page,
      limit,
      total,
    };
  }

  async getBookDetail(id: number): Promise<BookDetailDto> {
    const book = await this.books.findById(id);
    if (!book) {
      throw new NotFoundException({
        error: { code: 'NOT_FOUND', message: 'Book not found' },
      });
    }
    const [categories, sagas] = await Promise.all([
      this.categories.listForBook(id),
      this.sagas.listForBook(id),
    ]);
    return {
      ...toBookDto(book),
      file_size_bytes: book.fileSizeBytes,
      content_hash: book.contentHash,
      categories: categories.map((c) => ({
        id: c.id,
        path: c.path,
        name_es: c.nameEs,
        name_en: c.nameEn,
      })),
      sagas: sagas.map((s) => ({
        id: s.id,
        name: s.name,
        author_id: s.authorId,
      })),
    };
  }
}

function toBookDto(book: {
  id: number;
  title: string;
  authorId: number | null;
  year: number | null;
  language: string | null;
  format: string | null;
  filePath: string;
  coverPath: string | null;
  excerpt: string | null;
  indexedAt: Date;
}): BookDto {
  return {
    id: book.id,
    title: book.title,
    author_id: book.authorId,
    year: book.year,
    language: book.language,
    format: book.format,
    file_path: book.filePath,
    cover_path: book.coverPath,
    excerpt: book.excerpt,
    indexed_at: book.indexedAt.toISOString(),
  };
}