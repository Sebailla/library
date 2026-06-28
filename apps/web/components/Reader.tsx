'use client'

import dynamic from 'next/dynamic'
import { useMemo } from 'react'

import type { BookRow } from './BookList'
import { ProgressBar } from './ProgressBar'
import type { PdfBook } from './PdfViewer'

/**
 * Reader for a single book (PR-3B).
 *
 * Per `book-reader` + `pdf-reader` specs, this component is a Client
 * Component (`'use client'`) that mounts:
 *
 *  1. A header with the book's title and author
 *  2. A `<ProgressBar />` driven by the `currentPage` / `totalPages` props
 *  3. A lazy-loaded PDF surface via `next/dynamic({ ssr:false })`
 *
 * The PDF surface lives in a separate module so `pdfjs-dist`'s
 * ~1 MB payload is excluded from the initial bundle. The surface
 * is gated on `typeof window !== 'undefined'` so the route can
 * still render during SSR or in jsdom-based unit tests.
 *
 * The Reader takes the lightweight `BookRow` shape from the
 * catalog list and projects it into the richer `PdfBook` shape
 * the PDF surface needs (adding `filePath`).
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
}

function toPdfBook(book: BookRow): PdfBook {
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    filePath: '',
  }
}

export function Reader({ book, currentPage, totalPages }: ReaderProps): React.JSX.Element {
  // `useMemo` keeps the boolean stable across re-renders so React
  // does not tear down the dynamic boundary on every parent update.
  const isClient = useMemo(() => typeof window !== 'undefined', [])

  return (
    <section aria-label={`Reader for ${book.title}`}>
      <header>
        <h1>{book.title}</h1>
        <p>{book.author}</p>
      </header>

      <ProgressBar currentPage={currentPage} totalPages={totalPages} />

      {isClient ? (
        <PdfSurface book={toPdfBook(book)} currentPage={currentPage} />
      ) : (
        <div data-testid="reader-pdf-surface">Loading reader…</div>
      )}
    </section>
  )
}
