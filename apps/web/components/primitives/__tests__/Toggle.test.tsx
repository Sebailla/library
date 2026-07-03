import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

/**
 * TDD — RED phase for `components/primitives/Toggle.tsx`
 * (PR-C2, REQ-MCL-007).
 *
 * `Toggle` is a binary on/off switch used by feature surfaces
 * (the mac-browse-page filters + mac-reader-page settings panel
 * reference it). The contract under test:
 *
 *   - Renders a native `<button role="switch">` so screen readers
 *     announce it as a switch, not a checkbox.
 *   - `aria-checked` reflects the `checked` prop ("true" / "false").
 *   - Clicking the toggle flips the state (invokes `onChange(true)`).
 *   - Keyboard: pressing `Space` or `Enter` while focused also
 *     flips. Default browser behaviour for `<button>` would submit
 *     a form / trigger click on Enter, so the component must
 *     intercept both keys explicitly.
 *   - `disabled` prevents flips.
 *   - `data-testid` and `aria-label` are forwarded.
 */

import { Toggle } from '../Toggle'

describe('Toggle (PR-C2, REQ-MCL-007)', () => {
  it('renders a native <button role="switch">', () => {
    render(<Toggle checked={false} onChange={() => undefined} data-testid="t" />)

    const sw = screen.getByTestId('t')
    expect(sw.tagName).toBe('BUTTON')
    expect(sw).toHaveAttribute('role', 'switch')
  })

  it('reflects the checked prop on aria-checked', () => {
    const { rerender } = render(
      <Toggle checked={false} onChange={() => undefined} data-testid="t" />,
    )
    expect(screen.getByTestId('t')).toHaveAttribute('aria-checked', 'false')

    rerender(<Toggle checked={true} onChange={() => undefined} data-testid="t" />)
    expect(screen.getByTestId('t')).toHaveAttribute('aria-checked', 'true')
  })

  it('invokes onChange with the flipped value when clicked (uncontrolled flip)', () => {
    const onChange = vi.fn()
    render(<Toggle checked={false} onChange={onChange} data-testid="t" />)

    fireEvent.click(screen.getByTestId('t'))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('invokes onChange with !checked when Space is pressed', () => {
    const onChange = vi.fn()
    render(<Toggle checked={false} onChange={onChange} data-testid="t" />)

    const sw = screen.getByTestId('t')
    sw.focus()
    fireEvent.keyDown(sw, { key: ' ' })
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('invokes onChange with !checked when Enter is pressed', () => {
    const onChange = vi.fn()
    render(<Toggle checked={true} onChange={onChange} data-testid="t" />)

    const sw = screen.getByTestId('t')
    sw.focus()
    fireEvent.keyDown(sw, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith(false)
  })

  it('does not invoke onChange when disabled', () => {
    const onChange = vi.fn()
    render(
      <Toggle
        checked={false}
        onChange={onChange}
        disabled
        data-testid="t"
      />,
    )

    const sw = screen.getByTestId('t')
    fireEvent.click(sw)
    sw.focus()
    fireEvent.keyDown(sw, { key: ' ' })
    fireEvent.keyDown(sw, { key: 'Enter' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('forwards aria-label to the native <button>', () => {
    render(
      <Toggle
        checked={false}
        onChange={() => undefined}
        aria-label="Toggle dark mode"
        data-testid="t"
      />,
    )
    expect(screen.getByTestId('t')).toHaveAttribute('aria-label', 'Toggle dark mode')
  })
})
