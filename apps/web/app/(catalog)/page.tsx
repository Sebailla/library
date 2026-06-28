import { cacheLife, cacheTag } from 'next/cache'

import { BookList } from '@/components/BookList'
import { openLocalDb } from '@/lib/db/local-db'

/**
 * Reads the local library. PR-3A skeleton returns an empty list;
 * PR-3B replaces the implementation with the real better-sqlite3
 * query while keeping this function signature stable.
 *
 * `cacheLife('hours')` plus the `local-library` tag is the contract
 * the `nextjs-app-shell` spec requires for catalog reads, so the
 * downstream page can hand it straight into `'use cache'`.
 */
async function loadCatalog(): Promise<readonly { id: string; title: string; author: string; year: number }[]> {
  'use cache'
  cacheLife('hours')
  cacheTag('local-library')

  const db = openLocalDb()
  try {
    return db.listBooks()
  } finally {
    db.close()
  }
}

/**
 * Catalog index — React Server Component.
 *
 * Per `library-browse-ui` spec this is the first-paint route for
 * the local library. The BookList component is RSC-compatible so
 * the initial HTML carries the grid markup with zero JS roundtrip.
 * When the local DB is empty (PR-3A) the page renders the empty
 * state intentionally rather than a spinner — there is genuinely
 * nothing to show.
 */
export default async function CatalogPage(): Promise<React.JSX.Element> {
  const books = await loadCatalog()

  return (
    <main>
      <h1>My Library</h1>
      {books.length === 0 ? (
        <p data-testid="catalog-empty">
          Your library is empty. Scan a folder or download a book from the NAS.
        </p>
      ) : (
        <BookList books={books} />
      )}
    </main>
  )
}