import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

/**
 * TDD — RED phase for `components/ReaderToolbar.tsx`
 * (PR-C2, REQ-MRP-002 / REQ-MRP-003 / REQ-MRP-004).
 *
 * `ReaderToolbar` is the 52 px-tall bar that lives at the top of
 * the reader route. The contract under test (frozen by the spec
 * scenarios):
 *
 *   - Renders 7 controls in this exact order:
 *       1. Back to library (anchor → "/")        data-testid="reader-back"
 *       2. Previous chapter (button)              data-testid="reader-prev"
 *       3. Next chapter (button)                  data-testid="reader-next"
 *       4. Search placeholder (button, ⌘F)         data-testid="reader-search"
 *       5. Typography popover trigger (button)     data-testid="reader-typography"
 *       6. Theme picker swatches (3 buttons)       data-testid="reader-theme-{light,sepia,dark}"
 *       7. Close reader (anchor → "/")             data-testid="reader-close"
 *   - Every interactive element exposes an `aria-label`.
 *   - Clicking the typography button toggles a popover that
 *     contains 3 controls: font-size range (14–24), line-height
 *     range (1.4–2.0), font-family select (serif / sans).
 *   - Pressing `Escape` while focus is in the popover closes it.
 *   - Clicking a theme swatch invokes `onThemeChange(<id>)` with
 *     the matching theme id.
 *   - Changing a typography control invokes
 *     `onTypographyChange({ fontSize, lineHeight, fontFamily })`.
 */

import { ReaderToolbar } from '../ReaderToolbar'

const BASE_PROPS = {
  onBack: vi.fn(),
  onPrev: vi.fn(),
  onNext: vi.fn(),
  onSearch: vi.fn(),
  onTypographyChange: vi.fn(),
  typography: { fontSize: 18, lineHeight: 1.6, fontFamily: 'serif' as const },
  onThemeChange: vi.fn(),
  currentTheme: 'reader-light' as const,
}

describe('ReaderToolbar (PR-C2, REQ-MRP-002 / MRP-003 / MRP-004)', () => {
  it('renders the seven controls with the spec data-testid seams', () => {
    render(<ReaderToolbar {...BASE_PROPS} />)

    expect(screen.getByTestId('reader-back')).toBeInTheDocument()
    expect(screen.getByTestId('reader-prev')).toBeInTheDocument()
    expect(screen.getByTestId('reader-next')).toBeInTheDocument()
    expect(screen.getByTestId('reader-search')).toBeInTheDocument()
    expect(screen.getByTestId('reader-typography')).toBeInTheDocument()
    expect(screen.getByTestId('reader-theme-light')).toBeInTheDocument()
    expect(screen.getByTestId('reader-theme-sepia')).toBeInTheDocument()
    expect(screen.getByTestId('reader-theme-dark')).toBeInTheDocument()
    expect(screen.getByTestId('reader-close')).toBeInTheDocument()
  })

  it('gives every interactive control an aria-label', () => {
    render(<ReaderToolbar {...BASE_PROPS} />)

    for (const id of [
      'reader-back',
      'reader-prev',
      'reader-next',
      'reader-search',
      'reader-typography',
      'reader-theme-light',
      'reader-theme-sepia',
      'reader-theme-dark',
      'reader-close',
    ]) {
      const el = screen.getByTestId(id)
      expect(el.getAttribute('aria-label'), `missing aria-label on #${id}`).not.toBeNull()
    }
  })

  it('Back and Close are anchors pointing at "/" (proper link semantics)', () => {
    render(<ReaderToolbar {...BASE_PROPS} />)

    expect(screen.getByTestId('reader-back').tagName).toBe('A')
    expect(screen.getByTestId('reader-back')).toHaveAttribute('href', '/')
    expect(screen.getByTestId('reader-close').tagName).toBe('A')
    expect(screen.getByTestId('reader-close')).toHaveAttribute('href', '/')
  })

  it('fires onPrev and onNext when the chapter buttons are clicked', () => {
    render(<ReaderToolbar {...BASE_PROPS} />)
    fireEvent.click(screen.getByTestId('reader-prev'))
    fireEvent.click(screen.getByTestId('reader-next'))
    expect(BASE_PROPS.onPrev).toHaveBeenCalledTimes(1)
    expect(BASE_PROPS.onNext).toHaveBeenCalledTimes(1)
  })

  it('opens a typography popover on click with font-size, line-height, and font-family controls', () => {
    render(<ReaderToolbar {...BASE_PROPS} />)

    // Popover is closed initially — controls are not in the DOM.
    expect(screen.queryByTestId('typography-font-size')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('reader-typography'))

    expect(screen.getByTestId('typography-font-size')).toBeInTheDocument()
    expect(screen.getByTestId('typography-line-height')).toBeInTheDocument()
    expect(screen.getByTestId('typography-font-family')).toBeInTheDocument()
  })

  it('changing the font-size range input calls onTypographyChange with the new size', () => {
    render(<ReaderToolbar {...BASE_PROPS} />)
    fireEvent.click(screen.getByTestId('reader-typography'))

    fireEvent.change(screen.getByTestId('typography-font-size'), {
      target: { value: '20' },
    })

    expect(BASE_PROPS.onTypographyChange).toHaveBeenCalledWith({
      fontSize: 20,
      lineHeight: 1.6,
      fontFamily: 'serif',
    })
  })

  it('clicking the Sepia swatch invokes onThemeChange("reader-sepia")', () => {
    render(<ReaderToolbar {...BASE_PROPS} />)
    fireEvent.click(screen.getByTestId('reader-theme-sepia'))
    expect(BASE_PROPS.onThemeChange).toHaveBeenCalledWith('reader-sepia')
  })

  it('Escape closes the typography popover', () => {
    render(<ReaderToolbar {...BASE_PROPS} />)
    fireEvent.click(screen.getByTestId('reader-typography'))
    expect(screen.getByTestId('typography-font-size')).toBeInTheDocument()

    // Fire escape on the popover container so the host component's
    // keydown handler closes it.
    fireEvent.keyDown(screen.getByTestId('typography-popover'), {
      key: 'Escape',
    })
    expect(screen.queryByTestId('typography-font-size')).not.toBeInTheDocument()
  })
})
