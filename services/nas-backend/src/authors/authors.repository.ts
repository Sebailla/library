/**
 * Provider token for the authors repository inside the authors module.
 *
 * Exposed as a string token so e2e tests can override the
 * implementation with an in-memory stub via
 * ``Test.createTestingModule(...).overrideProvider``.
 */
export const AUTHORS_REPOSITORY = 'AUTHORS_REPOSITORY';

export {
  Author,
  NewAuthor,
  AuthorsRepository,
  AuthorsListOpts,
  PgAuthorsRepository,
  createAuthorsRepository,
} from '../repositories/authors.repository';