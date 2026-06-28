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

async function loadReader(bookId: string): Promise<React.JSX.Element> {
  'use cache'
  cacheLife('hours')
  cacheTag(`book:${bookId}`)

  const db = openLocalDb()
  let book = null
  let currentPage = 1
  let totalPages = 1

  try {
    book = db.findById(bookId)
    if (book) {
      const progress = db.getProgress(bookId)
      if (progress) {
        currentPage = progress.currentPage
      }
      // Total page count is not yet persisted (PR-3B ships the
      // scaffold only). PdfViewer will surface the file path and
      // let pdfjs discover the page count at render time.
      totalPages = Math.max(currentPage, 1)
    }
  } finally {
    db.close()
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

  return <Reader book={book} currentPage={currentPage} totalPages={totalPages} />
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
