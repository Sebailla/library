/**
 * Fixture data for BookList tests.
 *
 * Mirrors the shape of the rows returned by `lib/db/local-db.ts`
 * (real implementation in PR-3B). Kept deliberately small and
 * hand-authored so the assertion in BookList.test.tsx is obvious.
 */
export interface BookFixture {
  id: string
  title: string
  author: string
  year: number
}

export const fixtureBooks: readonly BookFixture[] = [
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