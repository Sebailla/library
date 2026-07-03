import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

/**
 * TDD — RED phase for `components/BrowseFilters.tsx`
 * (PR-D1, REQ-MBP-002).
 *
 * `BrowseFilters` renders the left sidebar of the Browse page with
 * three sections (Category / Format / Language). Each section is a
 * multi-select chip row whose state is held in the URL query string
 * so the page is shareable + refresh-safe.
 *
 * Contract under test:
 *
 *   - Renders three sections with the canonical chip sets:
 *     Category (fiction, non-fiction, science, tech, history),
 *     Format   (pdf, epub),
 *     Language (es, en).
 *   - Each chip is a `<button aria-pressed data-testid="filter-{section}-{value}">`.
 *   - URL params drive the initial state. Render with
 *     `?category=fiction&format=epub` → those chips have
 *     `aria-pressed="true"`.
 *   - Clicking a chip toggles the URL via `router.replace`. The
 *     new URL must reflect the toggled value (added if absent,
 *     removed if present).
 *   - Invalid values (e.g. `?format=docx`) coerce to "all" — no
 *     chip should have `aria-pressed="true"` for an invalid value.
 *
 * The `next/navigation` module is mocked so we can drive
 * `useSearchParams` + `useRouter` from the test without a real
 * Next.js router context.
 */

const { replaceMock, useSearchParamsMock } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  useSearchParamsMock: vi.fn((): URLSearchParams => new URLSearchParams()),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: useSearchParamsMock,
}))

import { BrowseFilters } from '../BrowseFilters'

const CATEGORIES = ['fiction', 'non-fiction', 'science', 'tech', 'history'] as const
const FORMATS = ['pdf', 'epub'] as const
const LANGUAGES = ['es', 'en'] as const

describe('BrowseFilters (PR-D1, REQ-MBP-002)', () => {
  beforeEach(() => {
    useSearchParamsMock.mockImplementation(() => new URLSearchParams())
    replaceMock.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders three sections with all canonical chips', () => {
    render(<BrowseFilters />)

    for (const value of CATEGORIES) {
      expect(screen.getByTestId(`filter-category-${value}`)).toBeInTheDocument()
    }
    for (const value of FORMATS) {
      expect(screen.getByTestId(`filter-format-${value}`)).toBeInTheDocument()
    }
    for (const value of LANGUAGES) {
      expect(screen.getByTestId(`filter-language-${value}`)).toBeInTheDocument()
    }
  })

  it('every chip is a <button aria-pressed>', () => {
    render(<BrowseFilters />)

    // Filter to the chip testids only (not the section wrappers).
    const chips = document.querySelectorAll(
      '[data-testid^="filter-category-"], [data-testid^="filter-format-"], [data-testid^="filter-language-"]',
    )
    expect(chips.length).toBeGreaterThan(0)
    for (const chip of chips) {
      expect(chip.tagName).toBe('BUTTON')
      expect(chip.getAttribute('aria-pressed')).toMatch(/^(true|false)$/)
    }
  })

  it('reads URL params as the initial state (?category=fiction&format=epub)', () => {
    useSearchParamsMock.mockImplementation(
      () => new URLSearchParams('category=fiction&format=epub'),
    )

    render(<BrowseFilters />)

    expect(screen.getByTestId('filter-category-fiction')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByTestId('filter-format-epub')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    // Sibling chips remain unpressed.
    expect(screen.getByTestId('filter-category-tech')).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.getByTestId('filter-format-pdf')).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('clicking an unpressed chip writes the URL param via router.replace', () => {
    render(<BrowseFilters />)

    fireEvent.click(screen.getByTestId('filter-category-fiction'))

    expect(replaceMock).toHaveBeenCalledTimes(1)
    const calledWith: string = replaceMock.mock.calls[0]?.[0] ?? ''
    expect(calledWith).toMatch(/category=fiction/)
  })

  it('clicking a pressed chip REMOVES the URL param (toggle off)', () => {
    useSearchParamsMock.mockImplementation(
      () => new URLSearchParams('category=fiction'),
    )

    render(<BrowseFilters />)

    fireEvent.click(screen.getByTestId('filter-category-fiction'))

    const calledWith: string = replaceMock.mock.calls[0]?.[0] ?? ''
    expect(calledWith).not.toMatch(/category=fiction/)
  })

  it('combinable across sections (?category=fiction + ?format=epub on click of format-epub)', () => {
    useSearchParamsMock.mockImplementation(
      () => new URLSearchParams('category=fiction'),
    )

    render(<BrowseFilters />)

    fireEvent.click(screen.getByTestId('filter-format-epub'))

    const calledWith: string = replaceMock.mock.calls[0]?.[0] ?? ''
    expect(calledWith).toMatch(/category=fiction/)
    expect(calledWith).toMatch(/format=epub/)
  })

  it('invalid values (e.g. ?format=docx) coerce to "all" — no chip pressed for an invalid value', () => {
    useSearchParamsMock.mockImplementation(
      () => new URLSearchParams('format=docx&category=fiction'),
    )

    render(<BrowseFilters />)

    // fiction is still pressed (valid).
    expect(screen.getByTestId('filter-category-fiction')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    // No format chip is pressed because `docx` is not a valid value.
    expect(screen.getByTestId('filter-format-pdf')).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.getByTestId('filter-format-epub')).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })
})