import { Suspense } from 'react'
import { cacheLife, cacheTag } from 'next/cache'

import { openLocalDb } from '@/lib/db/local-db'
import { Reader } from '@/components/Reader'

/**
 * Reader route — `/reader/[bookId]` (PR-3B).
 *
 * Per `book-reader` + `pdf-reader` specs the route must:
 *  - resolve the `bookId` from `params` (Next.js 15+ async params)
 *  - look the book up in the local SQLite (sync `better-sqlite3`)
 *  - mount the Client `<Reader />` so `pdfjs-dist` can lazy-load
 *
 * The page itself stays a Server Component so the DB read uses
 * `node:fs` + `better-sqlite3` without polluting the client bundle.
 * The Reader child is the only Client boundary; that keeps the
 * chunk that ships to the browser free of Node built-ins.
 *
 * The DB read is wrapped in `'use cache'` per the `nextjs-app-shell`
 * spec — the tag is per-book so PR-3E (when it wires annotation
 * saves) can call `revalidateTag('book:<id>')` to bust the cache
 * after the user closes the reader.
 *
 * The full EPUB implementation lands alongside the EPUB reader PR;
 * the `cfi-wrapper` scaffold (`lib/reader/cfi-wrapper.ts`) is the
 * versioned contract downstream readers depend on.
 */

type RouteParams = { bookId: string }

/**
 * Load the book for the reader route. Exported (not just used
 * internally) so the integration test in `__tests__/page.test.tsx`
 * can call it directly and assert on the JSX the route produces.
 *
 * The function stays async + `'use cache'` per the
 * `nextjs-app-shell` spec — that cache directive applies at
 * module load time, not at runtime, so test invocations just
 * run the body.
 */
export async function loadReader(bookId: string): Promise<React.JSX.Element> {
  'use cache'
  cacheLife('hours')
  cacheTag(`book:${bookId}`)

  let book = null
  let currentPage = 1
  let totalPages = 1

  try {
    const db = openLocalDb()
    try {
      book = db.findById(bookId)
      if (book) {
        const progress = db.getProgress(bookId)
        if (progress) {
          currentPage = progress.currentPage
        }
        // Total page count is not yet persisted (PR-3B ships
        // the scaffold only). PdfViewer will surface the file
        // path and let pdfjs discover the page count at render
        // time.
        totalPages = Math.max(currentPage, 1)
      }
    } finally {
      db.close()
    }
  } catch {
    // PR-3-fix-B #64 (CRITICAL): SQLite lock contention or
    // corruption MUST NOT 500 the reader. Render a friendly
    // error with a hint pointing at the recovery path
    // documented in README § "library.sqlite corruption
    // recovery".
    return (
      <main>
        <h1>Reader temporarily unavailable</h1>
        <p>
          The local library database could not be opened. This
          usually means another process holds the SQLite write
          lock, or the database file is corrupted.
        </p>
        <p>
          See the README section{' '}
          <code>library.sqlite corruption recovery</code> for the
          repair procedure (delete{' '}
          <code>library.sqlite</code> and rescan).
        </p>
      </main>
    )
  }

  if (!book) {
    return (
      <main>
        <h1>Book not found</h1>
        <p>
          No book with id <code>{bookId}</code> exists in the local library.
        </p>
      </main>
    )
  }

  // Per #59: the Reader's PdfSurface branch is gated on a
  // non-empty `filePath` prop (Reader.tsx:88). If we don't pass
  // it here the reader renders the "Loading reader…" placeholder
  // forever — the PDF never mounts. Thread the absolute path
  // straight from the local SQLite row.
  return (
    <Reader
      book={book}
      currentPage={currentPage}
      totalPages={totalPages}
      filePath={book.filePath}
    />
  )
}

async function ReaderView({
  params,
}: {
  params: Promise<RouteParams>
}): Promise<React.JSX.Element> {
  const { bookId } = await params
  return loadReader(bookId)
}

export default function ReaderPage({
  params,
}: {
  params: Promise<RouteParams>
}): React.JSX.Element {
  return (
    <Suspense fallback={<main><p>Loading reader…</p></main>}>
      <ReaderView params={params} />
    </Suspense>
  )
}
