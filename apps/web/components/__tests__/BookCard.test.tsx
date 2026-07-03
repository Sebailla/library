import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

/**
 * TDD — RED phase for `components/BookCard.tsx` (PR-C1, REQ-MCL-003).
 *
 * BookCard is the primitive every page-level grid consumes: Library
 * (PR-C1), Browse (PR-D1), Search (PR-D2). The contract under test:
 *
 *   - Outer element is an `<a href="/reader/<id>">` so the card is
 *     a single navigation target. `data-testid="book-card"` lands on
 *     that anchor.
 *   - Cover `<img>` has `data-testid="book-cover"`, `alt={title}`,
 *     `loading="lazy"`, and an enforced `aspect-[2/3]` so the grid
 *     rows are stable before the image loads.
 *   - On `onError` the cover swaps its `src` to an inline SVG data
 *     URL with the book's initials on a color hashed from the id
 *     (deterministic fallback per Open decision #3).
 *   - `compact` variant: width is 120 px and year + format chip
 *     are hidden.
 *   - When `book.progress` is defined, a `<progress>` element with
 *     value = progress * 100 and max = 100 is visible at the
 *     bottom of the cover.
 *   - Title and author are visible.
 */

import { BookCard } from '../BookCard'
import type { Book } from '@/lib/hooks/useSampleLibrary'

const FIXTURE: Book = {
  id: 'lib-test-book-001',
  title: 'Cien años de soledad',
  author: 'Gabriel García Márquez',
  year: 1967,
  format: 'epub',
  coverUrl: 'https://covers.openlibrary.org/b/isbn/9780307474728-M.jpg',
  lang: 'es',
}

const COMPACT_FIXTURE: Book = {
  id: 'lib-test-book-002',
  title: 'Ficciones',
  author: 'Jorge Luis Borges',
  year: 1999,
  format: 'pdf',
  coverUrl: 'https://covers.openlibrary.org/b/isbn/9780802130303-M.jpg',
  lang: 'es',
}

const PROGRESS_FIXTURE: Book = {
  ...FIXTURE,
  id: 'lib-test-book-003',
  progress: 0.42,
}

describe('BookCard (PR-C1, REQ-MCL-003)', () => {
  it('renders an <a data-testid="book-card"> with href="/reader/<id>"', () => {
    render(<BookCard book={FIXTURE} />)

    const card = screen.getByTestId('book-card')
    expect(card.tagName).toBe('A')
    expect(card).toHaveAttribute('href', '/reader/lib-test-book-001')
  })

  it('renders the cover image with the right alt and lazy-loading hint', () => {
    render(<BookCard book={FIXTURE} />)

    const img = screen.getByTestId('book-cover')
    expect(img.tagName).toBe('IMG')
    expect(img).toHaveAttribute('alt', 'Cien años de soledad')
    expect(img).toHaveAttribute('loading', 'lazy')
  })

  it('shows the title and author text', () => {
    render(<BookCard book={FIXTURE} />)

    expect(screen.getByText('Cien años de soledad')).toBeInTheDocument()
    expect(screen.getByText('Gabriel García Márquez')).toBeInTheDocument()
  })

  it('shows the year and format chip by default', () => {
    render(<BookCard book={FIXTURE} />)

    expect(screen.getByText(/1967/)).toBeInTheDocument()
    expect(screen.getByText(/epub/i)).toBeInTheDocument()
  })

  it('compact variant renders at 120px wide and hides year + format chip', () => {
    render(<BookCard book={COMPACT_FIXTURE} size="compact" />)

    const card = screen.getByTestId('book-card')
    expect(card.className).toMatch(/w-\[120px\]/)

    // Title and author are still visible.
    expect(screen.getByText('Ficciones')).toBeInTheDocument()
    // Year + format chip are NOT rendered.
    expect(screen.queryByText(/1999/)).not.toBeInTheDocument()
    expect(screen.queryByText(/pdf/i)).not.toBeInTheDocument()
  })

  it('swaps to the initials SVG placeholder on cover onError', () => {
    render(<BookCard book={FIXTURE} />)

    const img = screen.getByTestId('book-cover') as HTMLImageElement
    expect(img.src).toContain('covers.openlibrary.org')

    fireEvent.error(img)

    // After the swap, the src is a data: URL with an SVG body.
    expect(img.src).toMatch(/^data:image\/svg\+xml/)
    expect(img.src).toContain('svg')
  })

  it('renders a <progress> element when book.progress is set', () => {
    render(<BookCard book={PROGRESS_FIXTURE} />)

    const progress = screen.getByRole('progressbar')
    expect(progress).toHaveAttribute('value', '42')
    expect(progress).toHaveAttribute('max', '100')
  })

  it('does NOT render a <progress> element when book.progress is undefined', () => {
    render(<BookCard book={FIXTURE} />)

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })
})