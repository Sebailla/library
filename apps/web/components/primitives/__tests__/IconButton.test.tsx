import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

/**
 * TDD — RED phase for `components/primitives/IconButton.tsx` (PR-B, REQ-MCL-001).
 *
 * `IconButton` is a square, padding-free variant of Button used for
 * icon-only controls (Sidebar collapse toggle, ThemeToggle, Reader
 * toolbar actions). The contract:
 *
 *   - Native `<button>`.
 *   - Required `aria-label` (icon-only controls MUST be named for a11y).
 *   - Renders children (typically an SVG icon) inside the button.
 *   - Three square sizes: sm=24 / md=32 / lg=40 (Tailwind `h-6 w-6` etc).
 *   - `data-testid` forwarded to the outer element.
 *   - `onClick` fires when clicked.
 */

import { IconButton } from '../IconButton'

describe('IconButton (PR-B, REQ-MCL-001)', () => {
  it('renders a native <button> with the forwarded aria-label', () => {
    render(
      <IconButton aria-label="Toggle theme" data-testid="theme-toggle">
        <svg data-testid="theme-icon" />
      </IconButton>,
    )

    const btn = screen.getByTestId('theme-toggle')
    expect(btn.tagName).toBe('BUTTON')
    expect(btn).toHaveAttribute('aria-label', 'Toggle theme')
  })

  it('renders the children (icon) inside the button', () => {
    render(
      <IconButton aria-label="Toggle theme" data-testid="theme-toggle">
        <svg data-testid="theme-icon" />
      </IconButton>,
    )

    expect(screen.getByTestId('theme-icon')).toBeInTheDocument()
  })

  it('size="sm" applies the 24px square classes', () => {
    render(
      <IconButton aria-label="x" data-testid="btn" size="sm">
        <span>x</span>
      </IconButton>,
    )
    const btn = screen.getByTestId('btn')
    expect(btn.className).toMatch(/h-6\b/)
    expect(btn.className).toMatch(/w-6\b/)
  })

  it('size="md" applies the 32px square classes', () => {
    render(
      <IconButton aria-label="x" data-testid="btn" size="md">
        <span>x</span>
      </IconButton>,
    )
    const btn = screen.getByTestId('btn')
    expect(btn.className).toMatch(/h-8\b/)
    expect(btn.className).toMatch(/w-8\b/)
  })

  it('size="lg" applies the 40px square classes', () => {
    render(
      <IconButton aria-label="x" data-testid="btn" size="lg">
        <span>x</span>
      </IconButton>,
    )
    const btn = screen.getByTestId('btn')
    expect(btn.className).toMatch(/h-10\b/)
    expect(btn.className).toMatch(/w-10\b/)
  })

  it('fires onClick when the user clicks', () => {
    const onClick = vi.fn()
    render(
      <IconButton aria-label="x" data-testid="btn" onClick={onClick}>
        <span>x</span>
      </IconButton>,
    )

    fireEvent.click(screen.getByTestId('btn'))

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('forwards disabled to the native <button>', () => {
    render(
      <IconButton aria-label="x" data-testid="btn" disabled>
        <span>x</span>
      </IconButton>,
    )
    const btn = screen.getByTestId('btn') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })
})
