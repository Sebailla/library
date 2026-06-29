import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import type { BookRow } from '@/lib/db/local-db'
import { Reader } from '../Reader'

/**
 * TDD tests for `components/Reader.tsx` (PR-3B).
 *
 * Reader is a Client Component that:
 *  - renders the book title and author in the header
 *  - mounts a `<ProgressBar />` for the current page count
 *  - lazy-loads `pdfjs-dist` via `next/dynamic({ ssr:false })` (the
 *    pdf surface is verified via `data-testid` placeholder because
 *    pdfjs-dist cannot run under jsdom)
 *
 * The lazy-loaded surface is intentionally asserted via a stable
 * test id rather than via pdfjs internals — pdfjs-dist's DOM
 * surface requires a real browser environment, which PR-3E (Playwright
 * e2e) will provide.
 */

const sampleBook: BookRow = {
  id: 'book-001',
  title: 'Ficciones',
  author: 'Jorge Luis Borges',
  year: 1944,
  format: 'pdf',
  filePath: '/library/borges/ficciones.pdf',
  contentHash: 'sha256:abc',
  excerpt: 'Cuentos que desdibujan la realidad.',
}

describe('Reader', () => {
  it('renders the book title and author in the header', () => {
    render(
      <Reader
        book={sampleBook}
        currentPage={3}
        totalPages={10}
      />,
    )

    // The header must surface both the title and the author — they
    // are the primary identifying signals for the reader.
    expect(screen.getByRole('heading', { name: /ficciones/i })).toBeInTheDocument()
    expect(screen.getByText(/Jorge Luis Borges/)).toBeInTheDocument()
  })

  it('mounts a ProgressBar with the current and total page counts', () => {
    render(
      <Reader
        book={sampleBook}
        currentPage={3}
        totalPages={10}
      />,
    )

    // The ProgressBar must reflect the page numbers passed in,
    // proving the Reader forwards props correctly.
    expect(screen.getByText(/page 3 of 10/i)).toBeInTheDocument()
    expect(screen.getByText(/30%/)).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '30')
  })

  it('renders a placeholder for the lazy-loaded PDF surface', () => {
    render(
      <Reader
        book={sampleBook}
        currentPage={1}
        totalPages={1}
      />,
    )

    // The PDF surface is gated behind `next/dynamic({ ssr:false })`
    // so it does not run in this test. The Reader must still render
    // a stable placeholder so the route does not render an empty
    // page.
    expect(screen.getByTestId('reader-pdf-surface')).toBeInTheDocument()
  })
})
