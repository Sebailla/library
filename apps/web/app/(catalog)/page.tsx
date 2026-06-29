import { cacheLife, cacheTag } from 'next/cache'

import { BookList } from '@/components/BookList'
import { openLocalDb } from '@/lib/db/local-db'
import { PairWithNasForm } from './PairWithNasForm'

/**
 * Reads the local library. PR-3A skeleton returns an empty list;
 * PR-3B replaces the implementation with the real better-sqlite3
 * query while keeping this function signature stable.
 *
 * `cacheLife('hours')` plus the `local-library` tag is the contract
 * the `nextjs-app-shell` spec requires for catalog reads, so the
 * downstream page can hand it straight into `'use cache'`.
 *
 * PR-3-fix-B #64 (CRITICAL): the read is wrapped in try/catch so
 * a SQLite lock contention / corruption / permission-denied error
 * 500s the route. The empty list renders the empty-state CTA,
 * keeping the page reachable for the user to recover (see the
 * README's corruption-recovery section).
 *
 * Exported so the integration test in
 * `app/(catalog)/__tests__/catalog-page.test.tsx` can drive it
 * directly without going through the React render cycle.
 */
export async function loadCatalog(): Promise<readonly { id: string; title: string; author: string; year: number }[]> {
  'use cache'
  cacheLife('hours')
  cacheTag('local-library')

  try {
    const db = openLocalDb()
    try {
      return db.listBooks()
    } finally {
      db.close()
    }
  } catch {
    // SQLite lock contention or corruption. Mirrors the
    // (nas)/browse/page.tsx pattern: render an empty list so
    // the route stays reachable instead of 500ing. Operators
    // can recover by deleting `<ALEJANDRIA_DATA_DIR>/library.sqlite`
    // and re-scanning — see README "library.sqlite corruption
    // recovery".
    return []
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
 *
 * PR-3C adds a "Pair with NAS" CTA so the user can mint a bearer
 * token and start downloading. The form is a Server Action —
 * no JS roundtrip is needed to submit it.
 */
export default async function CatalogPage(): Promise<React.JSX.Element> {
  const books = await loadCatalog()

  return (
    <main>
      <h1>My Library</h1>
      <PairWithNasForm />
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
