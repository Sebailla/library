'use client'

import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

/**
 * `Button` — base interactive primitive (PR-B, REQ-MCL-001 / REQ-MCL-002).
 *
 *   - Native `<button>` element so disabled / focus / keyboard all work
 *     for free.
 *   - Four variants: primary / secondary / ghost / danger. Each maps to
 *     a distinct background-token class so themes apply automatically.
 *   - Three sizes: sm / md / lg. Padding + font-size scale with the
 *     design tokens.
 *   - `data-testid` forwarded via spread (`...rest`) so RTL queries
 *     land on the outer element (REQ-MCL-001).
 *   - `forwardRef` lets later primitives compose the Button without
 *     losing ref access.
 *
 * Token values come from `apps/web/app/globals.css` @theme block. Do
 * NOT hardcode hex colors here — use the CSS variables so the dark
 * theme flips surfaces for free.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

const BASE_CLASSES =
  'inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-md)] font-medium transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed'

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--color-accent)] text-white hover:opacity-90',
  secondary:
    'bg-[var(--color-surface-elevated)] text-[var(--color-text)] border border-[var(--color-border)] hover:bg-[var(--color-surface)]',
  ghost:
    'bg-transparent text-[var(--color-text)] hover:bg-[var(--color-surface)]',
  danger:
    'bg-red-600 text-white hover:opacity-90',
}

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'px-2.5 py-1 text-sm',
  md: 'px-3 py-1.5 text-sm',
  lg: 'px-4 py-2 text-base',
}

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  children?: ReactNode
}

/**
 * Forward the user's `ref` to the native `<button>`. We intentionally
 * accept the unused `children` in the props type so callers don't need
 * a separate `ButtonContent` slot — TS handles `ReactNode` defaults.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { variant = 'primary', size = 'md', className, children, ...rest },
    ref,
  ) {
    const classes = [
      BASE_CLASSES,
      VARIANT_CLASSES[variant],
      SIZE_CLASSES[size],
      className,
    ]
      .filter(Boolean)
      .join(' ')

    return (
      <button ref={ref} className={classes} {...rest}>
        {children}
      </button>
    )
  },
)
