import { cacheLife, cacheTag } from 'next/cache'

import { BookList } from '@/components/BookList'
import { openNasClient } from '@/lib/api/nas-client'

/**
 * First-page NAS browse (PR-3C).
 *
 * Reads the first page of the NAS catalog and projects each row
 * into the lightweight shape `BookList` needs. The full
 * `NasBook` surface stays on the server; the page never ships
 * the categories / sagas to the client.
 *
 * The cache contract follows `nextjs-app-shell`:
 * `cacheLife('hours')` plus the `nas-catalog` tag. PR-3D will
 * wire `updateTag()` / `revalidateTag()` to the NAS
 * `book.updated` event.
 */
async function loadNasBrowse(): Promise<readonly { id: string; title: string; author: string; year: number }[]> {
  'use cache'
  cacheLife('hours')
  cacheTag('nas-catalog')

  const client = openNasClient()
  try {
    const response = await client.listBooks({ page: 1, limit: 20 })
    return response.data.map((row) => ({
      // BookList takes a string id; the NAS row is a numeric id so
      // we coerce. The full `NasBook` shape is preserved on the
      // server so the (nas)/books/:id route can read the integer.
      id: String(row.id),
      title: row.title,
      // `author` is a derived field — the NAS row carries
      // `author_id` only. PR-3D joins against `/api/authors/:id`
      // for the display name; for now we materialise a placeholder
      // so the list is non-empty.
      author: row.author_id !== null ? `author:${row.author_id}` : 'unknown',
      year: row.year ?? 0,
    }))
  } catch {
    // The NAS may be offline (no `services/nas-backend` running
    // yet in dev). Render an empty list rather than crashing the
    // route — the empty-state CTA stays reachable.
    return []
  }
}

/**
 * NAS browse index — React Server Component.
 *
 * Per `nas-browse-download` spec this is the read-only view of
 * the remote catalog. Upload / edit / delete affordances MUST NOT
 * appear here; the spec is explicit about that.
 */
export default async function NasBrowsePage(): Promise<React.JSX.Element> {
  const books = await loadNasBrowse()

  return (
    <main>
      <h1>NAS Browse</h1>
      {books.length === 0 ? (
        <p data-testid="nas-empty">No books found.</p>
      ) : (
        <BookList books={books} />
      )}
    </main>
  )
}
