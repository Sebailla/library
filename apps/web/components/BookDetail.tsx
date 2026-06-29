import { BookDownloadForm } from '@/components/BookDownloadForm'
import type { BookRow } from '@/lib/db/local-db'

/**
 * Single-book detail card (PR-3C).
 *
 * RSC-compatible: the surrounding `<article>` is pure presentational
 * markup so the parent grid renders the card without any client
 * JS roundtrip. The `BookDownloadForm` is the only Client
 * Component nested inside — the `form action={…}` Server Action
 * binding keeps the submission path on the server.
 *
 * After #66: `BookRow` is the canonical 8-field DB row from
 * `@/lib/db/local-db` (id, title, author, year, format, filePath,
 * contentHash, excerpt). The component itself only renders four
 * fields, but the prop carries the full row so child components
 * (e.g. BookDownloadForm) have access to filePath / contentHash.
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
