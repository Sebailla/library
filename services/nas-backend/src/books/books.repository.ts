/**
 * Provider token for the books repository inside the books module.
 *
 * Lives here (rather than in ``src/repositories/books.repository.ts``)
 * so the HTTP module owns its dependency graph. Production code binds
 * the token to the pg-backed implementation; tests override it with
 * an in-memory stub via ``Test.createTestingModule``.
 */
export const BOOKS_REPOSITORY = 'BOOKS_REPOSITORY';

export {
  Book,
  NewBook,
  BooksRepository,
  PaginationOpts,
  ListFilters,
  PgBooksRepository,
  createBooksRepository,
} from '../repositories/books.repository';