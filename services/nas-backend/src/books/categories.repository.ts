/**
 * Provider token for the categories repository inside the books module.
 *
 * The books module needs categories to build the ``/api/books/:id``
 * detail response; this token gives the HTTP layer a seam for
 * stubbing in tests without touching the underlying pg implementation.
 */
export const CATEGORIES_REPOSITORY = 'CATEGORIES_REPOSITORY';

export {
  Category,
  NewCategory,
  CategoriesRepository,
  PgCategoriesRepository,
  createCategoriesRepository,
} from '../repositories/categories.repository';