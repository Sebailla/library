import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

/**
 * TDD — RED phase for `components/primitives/Button.tsx` (PR-B, REQ-MCL-001 / REQ-MCL-002).
 *
 * The Button primitive is the base interactive surface every other
 * primitive (Sidebar, Topbar, BookCard CTA, Reader toolbar) composes
 * from. The contract under test:
 *
 *   - Renders a native `<button>` element.
 *   - Forwards `data-testid` to the outer element (REQ-MCL-001).
 *   - `variant` maps to a distinct background-color class family
 *     (primary / secondary / ghost / danger).
 *   - `size` maps to a distinct padding / font-size class family
 *     (sm / md / lg).
 *   - Forwards `disabled` (the native `<button disabled>` attribute)
 *     and `onClick` (fires when the user clicks).
 */

import { Button } from '../Button'

describe('Button (PR-B, REQ-MCL-001 / REQ-MCL-002)', () => {
  it('renders a native <button> with the forwarded data-testid', () => {
    render(<Button data-testid="submit-btn">Save</Button>)

    const btn = screen.getByTestId('submit-btn')
    expect(btn.tagName).toBe('BUTTON')
    expect(btn).toHaveTextContent('Save')
  })

  it('uses the primary background token for variant="primary"', () => {
    render(<Button data-testid="btn" variant="primary">Go</Button>)
    const btn = screen.getByTestId('btn')
    // Primary fills with the accent token — assert via the CSS-variable
    // arbitrary value the design locks in.
    expect(btn.className).toMatch(/bg-\[var\(--color-accent\)\]/)
    expect(btn.className).toMatch(/text-white/)
  })

  it('uses an elevated-surface background for variant="secondary"', () => {
    render(<Button data-testid="btn" variant="secondary">Go</Button>)
    const btn = screen.getByTestId('btn')
    expect(btn.className).toMatch(/bg-\[var\(--color-surface-elevated\)\]/)
    expect(btn.className).toMatch(/border/)
  })

  it('is transparent for variant="ghost"', () => {
    render(<Button data-testid="btn" variant="ghost">Go</Button>)
    const btn = screen.getByTestId('btn')
    expect(btn.className).toMatch(/bg-transparent/)
  })

  it('uses the danger surface for variant="danger"', () => {
    render(<Button data-testid="btn" variant="danger">Delete</Button>)
    const btn = screen.getByTestId('btn')
    expect(btn.className).toMatch(/bg-red-600/)
  })

  it('size="sm" applies the small padding + font-size classes', () => {
    render(<Button data-testid="btn" size="sm">Go</Button>)
    const btn = screen.getByTestId('btn')
    expect(btn.className).toMatch(/px-2\.5/)
    expect(btn.className).toMatch(/py-1/)
    expect(btn.className).toMatch(/text-sm/)
  })

  it('size="md" applies the medium padding + font-size classes', () => {
    render(<Button data-testid="btn" size="md">Go</Button>)
    const btn = screen.getByTestId('btn')
    expect(btn.className).toMatch(/px-3/)
    expect(btn.className).toMatch(/py-1\.5/)
    expect(btn.className).toMatch(/text-sm/)
  })

  it('size="lg" applies the large padding + font-size classes', () => {
    render(<Button data-testid="btn" size="lg">Go</Button>)
    const btn = screen.getByTestId('btn')
    expect(btn.className).toMatch(/px-4/)
    expect(btn.className).toMatch(/py-2/)
    expect(btn.className).toMatch(/text-base/)
  })

  it('forwards the disabled attribute to the native <button>', () => {
    render(
      <Button data-testid="btn" disabled>
        Go
      </Button>,
    )
    const btn = screen.getByTestId('btn') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('fires onClick when the user clicks', () => {
    const onClick = vi.fn()
    render(
      <Button data-testid="btn" onClick={onClick}>
        Go
      </Button>,
    )

    fireEvent.click(screen.getByTestId('btn'))

    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
