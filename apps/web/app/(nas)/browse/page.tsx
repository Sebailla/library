import { cacheLife, cacheTag } from 'next/cache'

import { BookList } from '@/components/BookList'
import { openNasClient } from '@/lib/api/nas-client'

/**
 * First-page NAS browse. PR-3A skeleton returns an empty list; PR-3C
 * replaces the body with the real `GET /api/search` call while
 * keeping this signature stable.
 *
 * The cache contract follows nextjs-app-shell: `cacheLife('hours')`
 * plus the `nas-catalog` tag. PR-3C will wire `updateTag()` /
 * `revalidateTag()` to the NAS `book.updated` event.
 */
async function loadNasBrowse(): Promise<readonly { id: string; title: string; author: string; year: number }[]> {
  'use cache'
  cacheLife('hours')
  cacheTag('nas-catalog')

  const client = openNasClient()
  const hits = await client.search('')

  // Map NAS shape to BookList's BookRow shape so the component stays
  // storage-agnostic. Only the four fields the component needs are
  // projected; the full NasBook surface lands in PR-3C.
  return hits.map((hit) => ({
    id: hit.id,
    title: hit.title,
    author: hit.author,
    year: hit.year,
  }))
}

/**
 * NAS browse index — React Server Component.
 *
 * Per `nas-browse-download` spec this is the read-only view of the
 * remote catalog. Upload / edit / delete affordances MUST NOT
 * appear here; the spec is explicit about that. The pair-device
 * flow (PR-3C) gates this view behind a valid bearer token — for
 * PR-3A we render the empty state with the "Connect to NAS" prompt
 * so the route is browsable during scaffolding.
 */
export default async function NasBrowsePage(): Promise<React.JSX.Element> {
  const books = await loadNasBrowse()
  const hasToken = false // PR-3C: read token from keychain

  return (
    <main>
      <h1>NAS Browse</h1>
      {!hasToken ? (
        <section data-testid="nas-connect-prompt">
          <h2>Connect to NAS</h2>
          <p>
            Pair this device with your NAS to browse and download from the catalog.
            The pairing flow lands in PR-3C.
          </p>
        </section>
      ) : books.length === 0 ? (
        <p data-testid="nas-empty">No books found.</p>
      ) : (
        <BookList books={books} />
      )}
    </main>
  )
}