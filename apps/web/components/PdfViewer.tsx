'use client'

/**
 * Real PDF surface for the Reader (PR-3C).
 *
 * The component lazy-loads `pdfjs-dist` (it is the only reason this
 * module has a `'use client'` directive — `pdfjs` does not run on
 * the server). The Reader wraps it in `next/dynamic({ ssr: false })`
 * so the worker + ~1 MB payload never enter the initial page
 * bundle.
 *
 * Behaviour under test (see `components/__tests__/PdfViewer.test.tsx`):
 *
 *  - the worker source is set via the configurable `workerSrc`
 *    prop (defaulting to a CDN URL — production wires the
 *    bundled worker via the `?url` import suffix)
 *  - the requested page is rendered to a `<canvas>`
 *  - prev / next buttons advance the page and fire
 *    `onPageChange(page)` so the Reader's progress bar updates
 *  - prev is disabled on page 1, next on the last page
 *  - a render rejection is reported via `onError` so the parent
 *    can surface a fallback
 */

import { useEffect, useRef, useState } from 'react'

import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist'

/**
 * Default worker source. The PR-3C bundle ships the pdfjs worker
 * via `import.meta.url` so the production build resolves the
 * URL of the worker module that Vite / Turbopack produces. The
 * test suite (and offline dev mode) can override `workerSrc`
 * via the prop.
 */
const DEFAULT_WORKER_SRC = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  // Use the worker URL relative to the bundle. Webpack / Turbopack
  // rewrite this at build time to a stable asset URL.
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — `import.meta.url` is a build-time constant.
  typeof import.meta.url === 'string' ? import.meta.url : 'file:///',
).toString()

export interface PdfBook {
  id: string
  title: string
  author: string
  filePath: string
}

export interface PdfViewerProps {
  book: PdfBook
  currentPage: number
  onPageChange: (page: number) => void
  onError?: (error: Error) => void
  /** Override the pdfjs worker source (defaults to the bundled worker). */
  workerSrc?: string
}

let workerConfigured = false

interface PdfPageState {
  doc: PDFDocumentProxy
  numPages: number
}

export function PdfViewer({
  book,
  currentPage,
  onPageChange,
  onError,
  workerSrc = DEFAULT_WORKER_SRC,
}: PdfViewerProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [page, setPage] = useState<PdfPageState | null>(null)
  const [loadError, setLoadError] = useState<Error | null>(null)
  const [renderedPage, setRenderedPage] = useState<number>(currentPage)

  // Configure the worker exactly once per page lifetime. The
  // module-level guard short-circuits re-renders that pass the
  // same `workerSrc`; tests can flip it off via the prop.
  useEffect(() => {
    if (!workerConfigured || GlobalWorkerOptions.workerSrc !== workerSrc) {
      GlobalWorkerOptions.workerSrc = workerSrc
      workerConfigured = true
    }
  }, [workerSrc])

  // Open the document when the book changes. We treat `book.id`
  // as the identity signal so changing the source file (e.g. a
  // fresh download) tears down the previous `PDFDocumentProxy`.
  useEffect(() => {
    let cancelled = false
    setPage(null)
    setLoadError(null)
    getDocument({ url: book.filePath })
      .promise.then((doc) => {
        if (cancelled) {
          doc.destroy()
          return
        }
        setPage({ doc, numPages: doc.numPages })
      })
      .catch((err: unknown) => {
        const error = err instanceof Error ? err : new Error(String(err))
        if (cancelled) return
        setLoadError(error)
        if (onError) onError(error)
      })
    return () => {
      cancelled = true
    }
  }, [book.id, book.filePath, onError])

  // Render the requested page on every `currentPage` change.
  useEffect(() => {
    if (!page || !canvasRef.current) return
    let cancelled = false
    page.doc
      .getPage(currentPage)
      .then((pdfPage: PDFPageProxy) => {
        if (cancelled) return
        const viewport = pdfPage.getViewport({ scale: 1 })
        const canvas = canvasRef.current
        if (!canvas) return
        const context = canvas.getContext('2d')
        if (!context) return
        canvas.width = viewport.width
        canvas.height = viewport.height
        return pdfPage.render({ canvasContext: context, viewport }).promise
      })
      .then(() => {
        if (!cancelled) setRenderedPage(currentPage)
      })
      .catch((err: unknown) => {
        const error = err instanceof Error ? err : new Error(String(err))
        if (cancelled) return
        if (onError) onError(error)
      })
    return () => {
      cancelled = true
    }
  }, [page, currentPage, onError])

  const canPrev = renderedPage > 1
  const canNext = page !== null && renderedPage < page.numPages

  function goPrev() {
    if (!canPrev) return
    onPageChange(renderedPage - 1)
  }

  function goNext() {
    if (!canNext) return
    onPageChange(renderedPage + 1)
  }

  if (loadError) {
    return (
      <div data-testid="pdf-viewer-error" role="alert">
        <p>
          Could not load <strong>{book.title}</strong>: {loadError.message}
        </p>
      </div>
    )
  }

  return (
    <div data-testid="pdf-viewer">
      <canvas ref={canvasRef} data-testid="pdf-viewer-canvas" />
      <nav aria-label="PDF page navigation" style={{ marginTop: '0.5rem' }}>
        <button
          type="button"
          onClick={goPrev}
          disabled={!canPrev}
          aria-label="Previous page"
        >
          Prev
        </button>
        <span style={{ margin: '0 0.5rem' }} data-testid="pdf-viewer-page">
          {page ? `Page ${renderedPage} of ${page.numPages}` : 'Loading…'}
        </span>
        <button
          type="button"
          onClick={goNext}
          disabled={!canNext}
          aria-label="Next page"
        >
          Next
        </button>
      </nav>
    </div>
  )
}
