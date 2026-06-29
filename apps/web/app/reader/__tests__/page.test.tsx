import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { render } from '@testing-library/react'
import { Suspense } from 'react'

/**
 * Integration test for `/reader/[bookId]/page.tsx` (PR-3-fix-A).
 *
 * After #59, the page MUST pass `book.filePath` to the `<Reader>`
 * Client Component — otherwise the `filePath`-gated PdfSurface
 * branch in Reader.tsx:88 is dead code and the reader never
 * actually renders the PDF in production.
 *
 * The page is a Server Component, so we can't mount it through
 * `next/router` in a unit test. Instead we exercise the route's
 * data-loading helper `loadReader(bookId)`:
 *  1. Insert a book into a fresh local SQLite via openLocalDb.
 *  2. Call the exported `loadReader` with the book's id.
 *  3. Render the resulting JSX with React Testing Library.
 *  4. Assert the rendered Reader received the filePath.
 *
 * We assert this by mocking the `@/components/Reader` module so
 * the test captures the props the page passes — that is the
 * runtime signal that production code is wiring filePath.
 */

const { ReaderMock } = vi.hoisted(() => {
  // The mock captures every render's props so we can assert on
  // what the page actually passes through. The first call's props
  // are exported as `__lastProps` for the test assertions.
  return {
    ReaderMock: vi.fn((props: Record<string, unknown>) => {
      ;(ReaderMock as unknown as { __lastProps: unknown }).__lastProps = props
      return <div data-testid="reader-mock">Reader mock</div>
    }),
  }
})

vi.mock('@/components/Reader', () => ({
  Reader: (props: Record<string, unknown>) => ReaderMock(props),
}))

const { openLocalDb } = await import('@/lib/db/local-db')
const { loadReader } = await import('../[bookId]/page')

describe('reader route page (PR-3-fix-A, issue #59)', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'alejandria-reader-route-'))
    process.env['ALEJANDRIA_DATA_DIR'] = tmpDir
    ReaderMock.mockClear()
  })

  afterEach(() => {
    delete process.env['ALEJANDRIA_DATA_DIR']
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('passes book.filePath from the local DB row to <Reader filePath={...} />', async () => {
    // Seed the local SQLite with a book whose filePath we expect
    // to see threaded into the Reader prop.
    const db = openLocalDb()
    db.insertBook({
      id: 'book-001',
      title: 'Ficciones',
      author: 'Jorge Luis Borges',
      year: 1944,
      format: 'pdf',
      filePath: '/library/borges/ficciones.pdf',
      contentHash: 'sha256:abc',
      excerpt: 'Cuentos que desdibujan la realidad.',
    })
    db.close()

    const element = await loadReader('book-001')
    render(<Suspense>{element}</Suspense>)

    // The page MUST have rendered <Reader /> exactly once with
    // the book row AND the filePath. Before the #59 fix the page
    // passed only `book` + `currentPage` + `totalPages` — the
    // PdfSurface branch in Reader.tsx:88 was therefore dead code.
    expect(ReaderMock).toHaveBeenCalledTimes(1)
    const props = ReaderMock.mock.calls[0]![0] as Record<string, unknown>
    expect(props['filePath']).toBe('/library/borges/ficciones.pdf')
    const book = props['book'] as { id: string; filePath: string }
    expect(book.id).toBe('book-001')
    expect(book.filePath).toBe('/library/borges/ficciones.pdf')
  })

  it('renders a "Book not found" message when the bookId does not exist', async () => {
    const element = await loadReader('does-not-exist')
    const { getByRole } = render(<Suspense>{element}</Suspense>)
    expect(getByRole('heading', { name: /book not found/i })).toBeInTheDocument()
    // The Reader MUST NOT be called when the book is missing.
    expect(ReaderMock).not.toHaveBeenCalled()
  })
})