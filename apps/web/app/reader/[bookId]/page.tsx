'use client'

import { use } from 'react'

import { Reader } from '@/components/Reader'
import { openLocalDb } from '@/lib/db/local-db'

/**
 * Reader route — `/reader/[bookId]` (PR-3B).
 *
 * Per `book-reader` spec this is a Client Component because the
 * reader depends on `pdfjs-dist`, which is loaded lazily via
 * `next/dynamic({ ssr:false })` and therefore requires the browser
 * runtime.
 *
 * In Next.js 15+ the `params` object is asynchronous. `React.use()`
 * unwraps the promise without making the surrounding component
 * async, which is what we want here — the Reader is itself a
 * Client Component and this page is the route shell.
 *
 * The DB lookup is synchronous (`better-sqlite3`), so it runs in
 * the server pass before the Client Component boundary is crossed
 * in production. Under vitest, the page can be mounted with mocked
 * data via `<Reader book={…} />` directly; the route is exercised
 * end-to-end by the Playwright suite in PR-3E.
 */
type RouteParams = { bookId: string }

export default function ReaderPage({
  params,
}: {
  params: Promise<RouteParams>
}): React.JSX.Element {
  const { bookId } = use(params)

  // Resolve the book synchronously from the local DB. PR-3C will
  // fall back to the NAS when the row is missing locally.
  const db = openLocalDb()
  let book = db.findById(bookId)
  let currentPage = 1
  let totalPages = 1

  try {
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
