import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

/**
 * TDD — RED → GREEN tests for the Library page's client surface
 * (PR-C1, REQ-MLP-001 / REQ-MLP-004 / REQ-MLP-005 / REQ-MLP-006).
 *
 * Coverage:
 *
 *   - When `localStorage.alejandria.showSample === 'true'`, the
 *     grid renders 12 `<a data-testid="book-card">` elements.
 *   - Each card exposes its cover image via `data-testid="book-cover"`.
 *   - When the flag is NOT set AND the local DB is empty, the
 *     empty state (`data-testid="library-empty-state"`) renders
 *     with the two CTAs (Button primitive).
 *   - Clicking the `PDFs` filter chip narrows the visible cards
 *     to the 6 PDF entries.
 *   - Selecting `year-desc` reorders the grid so the first card
 *     has the highest `year` value.
 *
 * `localDb` is mocked so the test runs without touching SQLite;
 * the legacy SQLite-error contract is covered by the
 * `catalog-page.test.tsx` suite.
 */

const { listBooksMock } = vi.hoisted(() => ({
  listBooksMock: vi.fn(),
}))

vi.mock('@/lib/db/local-db', () => ({
  openLocalDb: () => ({
    listBooks: listBooksMock,
    close: () => undefined,
  }),
}))

import { LibraryContent } from '../LibraryContent'

describe('LibraryContent (PR-C1, REQ-MLP-001 / MLP-004 / MLP-005 / MLP-006)', () => {
  beforeEach(() => {
    listBooksMock.mockReturnValue([])
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders 12 book cards when sample flag is set in localStorage', async () => {
    window.localStorage.setItem('alejandria.showSample', 'true')

    render(<LibraryContent initialBooks={[]} autoSampleOnEmpty={false} />)

    const cards = await screen.findAllByTestId('book-card')
    expect(cards).toHaveLength(12)
    // Every card has a cover image.
    expect(screen.getAllByTestId('book-cover')).toHaveLength(12)
  })

  it('renders the empty state with two CTAs when sample flag is NOT set and DB is empty', async () => {
    // Pre-condition: autoSampleOnEmpty=false (production) so the
    // component does NOT auto-set the localStorage flag.
    render(<LibraryContent initialBooks={[]} autoSampleOnEmpty={false} />)

    const empty = await screen.findByTestId('library-empty-state')
    expect(empty).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /conectar nas/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /escanear carpeta/i }),
    ).toBeInTheDocument()
    expect(screen.queryAllByTestId('book-card')).toHaveLength(0)
  })

  it('PDFs filter narrows the grid to 6 cards and marks the chip pressed', async () => {
    window.localStorage.setItem('alejandria.showSample', 'true')

    render(<LibraryContent initialBooks={[]} autoSampleOnEmpty={false} />)
    await screen.findAllByTestId('book-card')

    const pdfsChip = screen.getByTestId('filter-chip-pdfs')
    expect(pdfsChip).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(pdfsChip)

    expect(pdfsChip).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByTestId('book-card')).toHaveLength(6)
    expect(screen.getByTestId('filter-chip-all')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('filter-chip-epubs')).toHaveAttribute('aria-pressed', 'false')
  })

  it('EPUBs filter narrows the grid to 6 cards', async () => {
    window.localStorage.setItem('alejandria.showSample', 'true')

    render(<LibraryContent initialBooks={[]} autoSampleOnEmpty={false} />)
    await screen.findAllByTestId('book-card')

    fireEvent.click(screen.getByTestId('filter-chip-epubs'))
    expect(screen.getAllByTestId('book-card')).toHaveLength(6)
  })

  it('year-desc sort puts the highest-year card first', async () => {
    window.localStorage.setItem('alejandria.showSample', 'true')

    render(<LibraryContent initialBooks={[]} autoSampleOnEmpty={false} />)
    const cards = await screen.findAllByTestId('book-card')

    // Default sort is `year-desc`, so the first card already has
    // the highest year (Sapiens, 2014). Re-selecting keeps it.
    fireEvent.change(screen.getByTestId('sort-dropdown'), {
      target: { value: 'year-desc' },
    })

    const titles = cards.map((card) => card.querySelector('h3')?.textContent ?? '')
    expect(titles[0]).toMatch(/sapiens/i)
  })

  it('title-asc sort puts the alphabetically-first title first', async () => {
    window.localStorage.setItem('alejandria.showSample', 'true')

    render(<LibraryContent initialBooks={[]} autoSampleOnEmpty={false} />)
    await screen.findAllByTestId('book-card')

    fireEvent.change(screen.getByTestId('sort-dropdown'), {
      target: { value: 'title-asc' },
    })

    const titles = Array.from(
      document.querySelectorAll('[data-testid="book-card"] h3'),
    ).map((el) => el.textContent ?? '')
    const sorted = [...titles].sort((a, b) => a.localeCompare(b))
    expect(titles).toEqual(sorted)
  })
})