/**
 * Minimal shape BookList needs to render a row.
 *
 * Kept structural rather than reusing the full local-db `BookRow`
 * (which lands in PR-3B) so the component stays decoupled from
 * the storage layer and tests stay fast — pure props in, JSX out.
 *
 * After #66: this is `BookListItem`, NOT `BookRow`. `BookRow`
 * lives in `@/lib/db/local-db` as the canonical 8-field DB row.
 */
export interface BookListItem {
  id: string
  title: string
  author: string
  year: number
}

/**
 * RSC-compatible list of books. Pure presentational component:
 * no event handlers, no `useState`, no `useEffect` — safe to
 * render inside a React Server Component.
 *
 * Each row's accessible name is the book's title, which is the
 * contract the BookList.test.tsx assertion depends on.
 */
export function BookList({ books }: { books: readonly BookListItem[] }): React.JSX.Element {
  return (
    <ul aria-label="Library catalog">
      {books.map((book) => (
        <li key={book.id} aria-label={book.title}>
          {book.title} — <span>{book.author}</span> ({book.year})
        </li>
      ))}
    </ul>
  )
}