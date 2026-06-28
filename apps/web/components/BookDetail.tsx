import type { BookRow } from '@/components/BookList'

/**
 * Single-book detail card. RSC-compatible: pure presentational,
 * no event handlers, no `useState`, no `useEffect`.
 *
 * PR-3A ships the surface only. PR-3B will:
 *  - accept a richer `BookDetail` type with cover_path, format,
 *    categories, and excerpt from the local DB
 *  - render a `<Link>` to `/reader/[bookId]`
 *  - show the categories hierarchy inherited from local-library-db
 *
 * Today it mirrors BookList's row shape so the catalog grid can
 * swap <li> rows for <BookDetail> cards without a refactor.
 */
export function BookDetail({ book }: { book: BookRow }): React.JSX.Element {
  return (
    <article aria-label={book.title}>
      <h2>{book.title}</h2>
      <p>
        <span>{book.author}</span> ({book.year})
      </p>
    </article>
  )
}