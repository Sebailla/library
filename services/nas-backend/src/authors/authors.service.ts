import {
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AUTHORS_REPOSITORY,
  AuthorsRepository,
} from './authors.repository';
import {
  BOOKS_REPOSITORY,
  BooksRepository,
} from '../books/books.repository';

/** Pagination defaults for ``GET /api/authors``. */
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;

/** Pagination request shape. */
export interface ListAuthorsQuery {
  page?: number;
  limit?: number;
}

/** Item shape returned by ``GET /api/authors``. */
export interface AuthorDto {
  id: number;
  lastname: string;
  firstname: string;
}

/** Response shape for ``GET /api/authors``. */
export interface ListAuthorsResponse {
  data: AuthorDto[];
  page: number;
  limit: number;
  total: number;
}

/** Book summary embedded in the author detail response. */
export interface AuthorBookDto {
  id: number;
  title: string;
  file_path: string;
}

/** Response shape for ``GET /api/authors/:id``. */
export interface AuthorDetailDto extends AuthorDto {
  books: AuthorBookDto[];
}

/**
 * Authors service — backs the ``/api/authors`` and
 * ``/api/authors/:id`` HTTP routes.
 *
 * The author detail route cross-references the books repository to
 * list the books written by the requested author. The cross-module
 * lookup keeps the service free of SQL — repositories stay the
 * only place that touches ``pg.Pool``.
 */
@Injectable()
export class AuthorsService {
  constructor(
    @Inject(AUTHORS_REPOSITORY) private readonly authors: AuthorsRepository,
    @Inject(BOOKS_REPOSITORY) private readonly books: BooksRepository,
  ) {}

  async listAuthors(query: ListAuthorsQuery): Promise<ListAuthorsResponse> {
    const page = Math.max(1, query.page ?? DEFAULT_PAGE);
    const limit = Math.min(100, Math.max(1, query.limit ?? DEFAULT_LIMIT));
    const offset = (page - 1) * limit;
    const [rows, total] = await Promise.all([
      this.authors.list({ limit, offset }),
      this.authors.count(),
    ]);
    return {
      data: rows.map((a) => ({
        id: a.id,
        lastname: a.lastname,
        firstname: a.firstname,
      })),
      page,
      limit,
      total,
    };
  }

  async getAuthorDetail(id: number): Promise<AuthorDetailDto> {
    const author = await this.authors.findById(id);
    if (!author) {
      throw new NotFoundException({
        error: { code: 'NOT_FOUND', message: 'Author not found' },
      });
    }
    const books = await this.books.listByAuthor(id);
    return {
      id: author.id,
      lastname: author.lastname,
      firstname: author.firstname,
      books: books.map((b) => ({
        id: b.id,
        title: b.title,
        file_path: b.filePath,
      })),
    };
  }
}