'use client'

/**
 * Lazy-loaded PDF surface for the Reader (PR-3B).
 *
 * This module is dynamically imported via `next/dynamic({ ssr:false })`
 * so the `pdfjs-dist` worker + ~1 MB payload never enter the initial
 * page bundle. The actual rendering implementation lands in PR-3E —
 * for now the component renders a placeholder that surfaces the
 * current page so the route is not empty.
 *
 * The `pdfjs-dist` integration (worker source, page render loop,
 * canvas allocation) is the next PR's work unit. See
 * `openspec/changes/alejandria-v2/specs/pdf-reader/spec.md`.
 */

export interface PdfBook {
  id: string
  title: string
  author: string
  filePath: string
}

export function PdfViewer({
  book,
  currentPage,
}: {
  book: PdfBook
  currentPage: number
}): React.JSX.Element {
  return (
    <div data-testid="pdf-viewer">
      <p>
        PDF viewer for <strong>{book.title}</strong> (page {currentPage})
      </p>
      <p data-testid="pdf-viewer-source">{book.filePath}</p>
    </div>
  )
}
