'use client'

import { forwardRef, type InputHTMLAttributes } from 'react'

/**
 * `Input` — text-input primitive styled with the design tokens
 * (PR-D1, REQ-MCL-001).
 *
 *   - Native `<input>` so disabled / focus / keyboard / autofill
 *     all work for free.
 *   - All visual surface comes from the CSS variables declared in
 *     `app/globals.css` (no hex literals). Focus ring uses the
 *     `--color-accent` token; the error state uses an
 *     `aria-[invalid=true]` selector so the input is still fully
 *     controlled by the caller (no DOM-class wiring needed).
 *   - `error` toggles `aria-invalid` (REQ-MCL-001) — the visual
 *     "invalid" treatment is opt-in via the boolean prop.
 *   - `data-testid`, `aria-label`, `placeholder`, `type`, `value`
 *     and `onChange` are forwarded via spread.
 *   - `forwardRef` so callers (Search page input, Browse search)
 *     can focus imperatively if needed.
 */

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** When `true`, the input exposes `aria-invalid="true"` for a11y. */
  error?: boolean
  /** Reserved for future size variants; matches the Button API. */
  inputSize?: 'sm' | 'md' | 'lg'
}

const INPUT_BASE_CLASSES =
  'w-full px-3 py-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] aria-[invalid=true]:border-red-500'

export const Input = forwardRef<HTMLInputElement, InputProps>(
  function Input({ error, inputSize: _inputSize, className, ...rest }, ref) {
    const classes = [INPUT_BASE_CLASSES, className].filter(Boolean).join(' ')
    return (
      <input
        ref={ref}
        className={classes}
        aria-invalid={error ? true : undefined}
        {...rest}
      />
    )
  },
)