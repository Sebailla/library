import { Suspense } from 'react'
import { cacheLife, cacheTag } from 'next/cache'

import { LibraryContent } from './LibraryContent'
import { PairWithNasForm } from './PairWithNasForm'
import { useSampleLibrary, type Book } from '@/lib/hooks/useSampleLibrary'
import { openLocalDb } from '@/lib/db/local-db'

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
 * `app/(app)/__tests__/catalog-page.test.tsx` can drive it
 * directly without going through the React render cycle.
 *
 * Retained in PR-C1 (REQ-MLP-001) so the legacy SQLite error
 * contract from PR-3-fix-B stays covered even after the page
 * surface was redesigned.
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
 * Read the local DB and project rows to the `Book` shape the
 * client expects. Mirrors the try/catch in `loadCatalog` so a
 * SQLite error renders the empty-state CTA instead of 500ing
 * the route (PR-3-fix-B / #64). Cached at the same lifetime /
 * tag as `loadCatalog` so the two reads stay coherent.
 */
async function readLocalBooks(): Promise<readonly Book[]> {
  'use cache'
  cacheLife('hours')
  cacheTag('local-library')

  try {
    const db = openLocalDb()
    try {
      const rows = db.listBooks()
      return rows.map(
        (row): Book => ({
          id: row.id,
          title: row.title,
          author: row.author,
          year: row.year,
          format: row.format === 'epub' ? 'epub' : 'pdf',
          coverUrl: '',
        }),
      )
    } finally {
      db.close()
    }
  } catch {
    return []
  }
}

/**
 * Inner Server Component for the Library page (PR-C1,
 * REQ-MLP-001). Reads `searchParams`, decides between sample
 * and real data, then hands the resolved list to the client
 * `LibraryContent`. The outer `LibraryPage` wraps this in
 * `<Suspense>` so Next.js 16 `cacheComponents` is happy with
 * the cached data access (see the reader route for the same
 * pattern).
 */
async function LibraryView({
  searchParams,
}: {
  searchParams?: Promise<{ sample?: string }>
}): Promise<React.JSX.Element> {
  const params = searchParams ? await searchParams : undefined
  const forceSample = params?.sample === 'true'

  let initialBooks: readonly Book[]
  let autoSampleOnEmpty: boolean

  if (forceSample) {
    initialBooks = useSampleLibrary()
    autoSampleOnEmpty = false
  } else {
    const localBooks = await readLocalBooks()
    if (localBooks.length > 0) {
      initialBooks = localBooks
      autoSampleOnEmpty = false
    } else {
      initialBooks = []
      autoSampleOnEmpty = process.env['NODE_ENV'] !== 'production'
    }
  }

  return (
    <div>
      <h1 className="sr-only">My Library</h1>
      <LibraryContent
        initialBooks={initialBooks}
        autoSampleOnEmpty={autoSampleOnEmpty}
      />
      <PairWithNasForm />
    </div>
  )
}

/**
 * Library page — default export (Server Component shell).
 *
 * Source of truth for which dataset to render:
 *
 *   1. URL `?sample=true` — forces the sample dataset
 *      (verified by the curl smoke test in the spec).
 *   2. Real local DB — projected to the `Book` shape.
 *   3. Otherwise — pass an empty list + `autoSampleOnEmpty=true`
 *      so the client `LibraryContent` decides whether to auto-set
 *      `localStorage.alejandria.showSample` (dev only) or render
 *      the empty state (production).
 *
 * `PairWithNasForm` lives below the grid (PR-3C kept it here; the
 * redesigned page does not move it so any bookmarked anchor
 * remains stable).
 */
export default function LibraryPage({
  searchParams,
}: {
  searchParams?: Promise<{ sample?: string }>
}): React.JSX.Element {
  return (
    <Suspense fallback={<div className="py-16 text-center text-sm text-[var(--color-text-muted)]">Cargando…</div>}>
      <LibraryView searchParams={searchParams} />
    </Suspense>
  )
}