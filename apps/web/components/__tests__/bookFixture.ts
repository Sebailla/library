import type { BookListItem } from '../BookList'

/**
 * Fixture data for BookList tests.
 *
 * After #66, the fixture type is the structural `BookListItem` —
 * the same shape `<BookList />` consumes as its `books` prop.
 * The canonical 8-field DB row lives in `@/lib/db/local-db` and
 * can be projected down to a `BookListItem` for rendering.
 */
export type BookListItemFixture = BookListItem

export const fixtureBooks: readonly BookListItemFixture[] = [
  {
    id: 'book-001',
    title: 'Ficciones',
    author: 'Jorge Luis Borges',
    year: 1944,
  },
  {
    id: 'book-002',
    title: 'El Aleph',
    author: 'Jorge Luis Borges',
    year: 1949,
  },
  {
    id: 'book-003',
    title: 'Fundación',
    author: 'Isaac Asimov',
    year: 1951,
  },
] as const