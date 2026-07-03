'use client'

import type { KeyboardEvent, MouseEvent } from 'react'

/**
 * `Toggle` — accessible binary switch primitive (PR-C2, REQ-MCL-007).
 *
 *   - Renders a native `<button role="switch">` so screen readers
 *     announce it as a switch (not a checkbox).
 *   - `aria-checked` reflects the current value of the `checked`
 *     prop. Hosts are expected to render this as controlled state;
 *     the component does not maintain its own boolean.
 *   - Clicking OR pressing Space / Enter while focused flips the
 *     state via `onChange(!checked)`. The component does NOT prevent
 *     `Space` from scrolling — it calls `preventDefault()` on both
 *     Space and Enter so neither key triggers the browser default
 *     (Space would scroll the page on `<button type="submit">`).
 *   - When `disabled` is true, both click and keydown handlers are
 *     no-ops; the underlying `<button disabled>` already blocks
 *     native activation.
 *   - `data-testid` and `aria-label` forwarded to the rendered
 *     `<button>` (REQ-MCL-001 seam).
 *
 * Visual surface (REQ-MCL-007: visual state must change using
 * design tokens, must NOT rely on color alone):
 *
 *   - Track:  `bg-[var(--color-accent)]` when checked,
 *             `bg-[var(--color-border)]` otherwise.
 *   - Thumb position: `translate-x-4` when checked, identity otherwise.
 *   - A state descriptor visually accompanies the thumb via the
 *     `aria-checked` attribute and the thumb translation — no
 *     colour-only signal.
 */

export interface ToggleProps {
  /** Controlled checked state. */
  checked: boolean
  /** Fired with the flipped value when the user activates the switch. */
  onChange: (next: boolean) => void
  /** Disables clicks + keyboard activation. */
  disabled?: boolean
  /** A11y name (required for icon-only switches in real surfaces). */
  'aria-label'?: string
  /** Forwarded to the rendered `<button>`. */
  'data-testid'?: string
}

const TRACK_BASE_CLASSES =
  'relative inline-block w-9 h-5 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-1'

const THUMB_BASE_CLASSES =
  'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform'

export function Toggle({
  checked,
  onChange,
  disabled,
  'aria-label': ariaLabel,
  'data-testid': dataTestid,
}: ToggleProps): React.JSX.Element {
  const trackClasses = [
    TRACK_BASE_CLASSES,
    checked
      ? 'bg-[var(--color-accent)]'
      : 'bg-[var(--color-border)]',
    disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
  ].join(' ')

  const thumbClasses = [
    THUMB_BASE_CLASSES,
    checked ? 'translate-x-4' : 'translate-x-0',
  ].join(' ')

  function handleClick(): void {
    if (disabled) return
    onChange(!checked)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (disabled) return
    if (event.key !== ' ' && event.key !== 'Enter') return
    event.preventDefault()
    onChange(!checked)
  }

  // Suppress unused-var lint on MouseEvent (kept in the import for
  // documentation; click semantics live on the native <button>).
  const _eventType: MouseEvent<HTMLButtonElement> | null = null
  void _eventType

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked ? 'true' : 'false'}
      aria-label={ariaLabel}
      data-testid={dataTestid}
      disabled={disabled}
      className={trackClasses}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <span aria-hidden="true" className={thumbClasses} />
    </button>
  )
}
