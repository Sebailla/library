import { BookDownloadForm } from '@/components/BookDownloadForm'
import type { BookRow } from '@/components/BookList'

/**
 * Single-book detail card (PR-3C).
 *
 * RSC-compatible: the surrounding `<article>` is pure presentational
 * markup so the parent grid renders the card without any client
 * JS roundtrip. The `BookDownloadForm` is the only Client
 * Component nested inside — the `form action={…}` Server Action
 * binding keeps the submission path on the server.
 */
export function BookDetail({ book }: { book: BookRow }): React.JSX.Element {
  return (
    <article aria-label={book.title}>
      <h2>{book.title}</h2>
      <p>
        <span>{book.author}</span> ({book.year})
      </p>
      <BookDownloadForm book={book} />
    </article>
  )
}
