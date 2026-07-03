import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

/**
 * TDD — RED phase for `components/primitives/ProgressBar.tsx`
 * (PR-C1, REQ-MCL-008).
 *
 * The ProgressBar primitive is the visual reading-progress
 * surface consumed by BookCard (cover overlay) and Reader
 * (page progress). The contract under test:
 *
 *   - Renders a native `<progress>` element with `value` and
 *     `max` attributes forwarded to the DOM.
 *   - `data-testid` reaches the outer element so RTL can
 *     query it without depending on class names.
 *   - `value` is clamped to [0, max] — out-of-range inputs
 *     never produce a negative width or >100% fill.
 *   - Clicking the track invokes `onSeek(fraction)` with the
 *     computed fraction in [0, 1] so the host can persist a
 *     new position. The fraction is derived from the click X
 *     coordinate relative to the bounding rect.
 */

import { ProgressBar } from '../ProgressBar'

describe('ProgressBar (PR-C1, REQ-MCL-008)', () => {
  it('renders a native <progress> element with value and max attributes', () => {
    render(<ProgressBar value={42} max={100} data-testid="bar" />)

    const bar = screen.getByTestId('bar')
    expect(bar.tagName).toBe('PROGRESS')
    expect(bar).toHaveAttribute('value', '42')
    expect(bar).toHaveAttribute('max', '100')
  })

  it('defaults max to 100 when not provided', () => {
    render(<ProgressBar value={30} data-testid="bar" />)

    const bar = screen.getByTestId('bar')
    expect(bar).toHaveAttribute('max', '100')
  })

  it('clamps the value to [0, max] when value exceeds max', () => {
    render(<ProgressBar value={250} max={100} data-testid="bar" />)

    const bar = screen.getByTestId('bar')
    // Clamped value reaches the DOM as `max`.
    expect(bar).toHaveAttribute('value', '100')
  })

  it('clamps the value to 0 when value is negative', () => {
    render(<ProgressBar value={-5} max={100} data-testid="bar" />)

    const bar = screen.getByTestId('bar')
    expect(bar).toHaveAttribute('value', '0')
  })

  it('invokes onSeek with the computed fraction when the track is clicked', () => {
    const onSeek = vi.fn()
    render(<ProgressBar value={50} max={100} onSeek={onSeek} data-testid="bar" />)

    const track = screen.getByTestId('bar-track')
    // Stub bounding rect: track is 200px wide, click is at x=50 → 0.25.
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      right: 200,
      top: 0,
      bottom: 10,
      width: 200,
      height: 10,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    fireEvent.click(track, { clientX: 50 })

    expect(onSeek).toHaveBeenCalledTimes(1)
    expect(onSeek).toHaveBeenCalledWith(0.25)
  })

  it('does not invoke onSeek when no handler is provided', () => {
    render(<ProgressBar value={50} max={100} data-testid="bar" />)

    const track = screen.getByTestId('bar-track')
    // Should not throw even though onSeek is undefined.
    expect(() => fireEvent.click(track)).not.toThrow()
  })
})