'use client'

import dynamic from 'next/dynamic'
import { useCallback, useMemo, useState } from 'react'

import type { BookRow } from '@/lib/db/local-db'
import { ProgressBar } from './ProgressBar'
import type { PdfBook } from './PdfViewer'

/**
 * Reader for a single book (PR-3C).
 *
 * Per `book-reader` + `pdf-reader` specs the component is a Client
 * Component (`'use client'`) that mounts:
 *
 *  1. A header with the book's title and author
 *  2. A `<ProgressBar />` driven by the current page + total pages
 *  3. A lazy-loaded PDF surface via `next/dynamic({ ssr:false })`
 *
 * The PDF surface lives in a separate module so `pdfjs-dist`'s
 * ~1 MB payload is excluded from the initial bundle. The surface
 * is gated on `typeof window !== 'undefined'` so the route can
 * still render during SSR or in jsdom-based unit tests.
 *
 * Page navigation flows through the Reader's local `currentPage`
 * state, and the `onPageChange` prop is fired so the parent route
 * can persist the new position to the local SQLite.
 */

const PdfSurface = dynamic(
  () => import('./PdfViewer').then((m) => m.PdfViewer),
  {
    ssr: false,
    loading: () => <div data-testid="reader-pdf-surface">Loading reader…</div>,
  },
)

export interface ReaderProps {
  book: BookRow
  currentPage: number
  totalPages: number
  /** Absolute path to the PDF on disk (optional — surfaces "missing" UI when absent). */
  filePath?: string
  /** Forwarded to the parent so it can persist progress. */
  onPageChange?: (page: number) => void
}

function toPdfBook(book: BookRow, filePath: string): PdfBook {
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    filePath,
  }
}

export function Reader({
  book,
  currentPage,
  totalPages,
  filePath,
  onPageChange,
}: ReaderProps): React.JSX.Element {
  // `useMemo` keeps the boolean stable across re-renders so React
  // does not tear down the dynamic boundary on every parent update.
  const isClient = useMemo(() => typeof window !== 'undefined', [])
  // Local page state — PdfViewer's next/prev buttons fire
  // `onPageChange` which advances this. The parent route is also
  // notified so it can persist progress.
  const [page, setPage] = useState(currentPage)
  const handlePageChange = useCallback(
    (next: number) => {
      setPage(next)
      if (onPageChange) onPageChange(next)
    },
    [onPageChange],
  )

  return (
    <section aria-label={`Reader for ${book.title}`}>
      <header>
        <h1>{book.title}</h1>
        <p>{book.author}</p>
      </header>

      <ProgressBar currentPage={page} totalPages={totalPages} />

      {isClient && filePath ? (
        <PdfSurface
          book={toPdfBook(book, filePath)}
          currentPage={page}
          onPageChange={handlePageChange}
        />
      ) : (
        <div data-testid="reader-pdf-surface">Loading reader…</div>
      )}
    </section>
  )
}
