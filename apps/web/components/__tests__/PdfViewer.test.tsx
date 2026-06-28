import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

/**
 * TDD tests for `components/PdfViewer.tsx` (PR-3C).
 *
 * The previous PR shipped a placeholder; this PR wires the
 * `pdfjs-dist` integration:
 *
 *  - the component lazy-loads `pdfjs-dist` (mocked here) and
 *    renders the current page to a `<canvas>`
 *  - prev / next buttons advance the page and fire the
 *    `onPageChange` callback so the Reader's progress bar can
 *    reflect the new position
 *  - the worker source is set to a bundled data URL so the test
 *    does not need a network round-trip
 */

const renderPageMock = vi.fn(async () => ({
  getViewport: vi.fn(() => ({ width: 100, height: 100 })),
  render: vi.fn(() => ({ promise: Promise.resolve() })),
}))

const getDocumentMock = vi.fn(() => ({
  promise: Promise.resolve({
    numPages: 3,
    getPage: vi.fn(async () => renderPageMock()),
    destroy: vi.fn(),
  }),
}))

const globalWorkerMock = vi.fn()

vi.mock('pdfjs-dist', () => ({
  getDocument: getDocumentMock,
  GlobalWorkerOptions: { workerSrc: '' },
}))

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({
  default: 'data:application/javascript,worker-stub',
}))

import { PdfViewer } from '../PdfViewer'

const SAMPLE_BOOK = {
  id: 'book-001',
  title: 'Ficciones',
  author: 'Jorge Luis Borges',
  filePath: '/library/ficciones.pdf',
}

describe('PdfViewer (PR-3C)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lazy-loads pdfjs-dist and renders the requested page', async () => {
    await act(async () => {
      render(<PdfViewer book={SAMPLE_BOOK} currentPage={1} onPageChange={() => {}} />)
    })

    expect(getDocumentMock).toHaveBeenCalledTimes(1)
    expect(renderPageMock).toHaveBeenCalledWith(1)
  })

  it('shows prev / next buttons and disables prev on page 1', async () => {
    await act(async () => {
      render(<PdfViewer book={SAMPLE_BOOK} currentPage={1} onPageChange={() => {}} />)
    })

    const next = screen.getByRole('button', { name: /next/i })
    const prev = screen.getByRole('button', { name: /prev/i })

    // Prev must be disabled on the first page so the user cannot
    // walk into a negative index.
    expect(prev).toBeDisabled()
    expect(next).not.toBeDisabled()
  })

  it('fires onPageChange when the user clicks next', async () => {
    const onPageChange = vi.fn()
    await act(async () => {
      render(<PdfViewer book={SAMPLE_BOOK} currentPage={1} onPageChange={onPageChange} />)
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /next/i }))
    })

    expect(onPageChange).toHaveBeenCalledWith(2)
  })

  it('disables next on the last page', async () => {
    await act(async () => {
      render(<PdfViewer book={SAMPLE_BOOK} currentPage={3} onPageChange={() => {}} />)
    })

    const next = screen.getByRole('button', { name: /next/i })
    expect(next).toBeDisabled()
  })

  it('sets the pdfjs-dist worker source to a bundled data URL', async () => {
    const { GlobalWorkerOptions } = await import('pdfjs-dist')
    await act(async () => {
      render(<PdfViewer book={SAMPLE_BOOK} currentPage={1} onPageChange={() => {}} />)
    })
    expect(GlobalWorkerOptions.workerSrc).toBe('data:application/javascript,worker-stub')
  })

  it('forwards pdfjs page load errors to the onError callback', async () => {
    const onError = vi.fn()
    getDocumentMock.mockReturnValueOnce({
      promise: Promise.reject(new Error('broken pdf')),
    })
    await act(async () => {
      render(
        <PdfViewer
          book={SAMPLE_BOOK}
          currentPage={1}
          onPageChange={() => {}}
          onError={onError}
        />,
      )
    })
    // The error callback must fire on render rejection so the
    // Reader can show a fallback UI.
    expect(onError).toHaveBeenCalled()
  })
})
