'use client'

import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

/**
 * `IconButton` — square, padding-free Button variant for icon-only
 * controls (PR-B, REQ-MCL-001).
 *
 * Same visual contract as Button minus the padding / font-size — a
 * fixed square hit target sized by `size`. `aria-label` is required
 * at the type level so icon-only buttons never ship unnamed (a11y
 * requirement from REQ-MCL-001 / mac-app-shell REQ-MAS-003).
 *
 * Token values come from `apps/web/app/globals.css` @theme block.
 */

export type IconButtonSize = 'sm' | 'md' | 'lg'

const BASE_CLASSES =
  'inline-flex items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text)] hover:bg-[var(--color-surface)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] disabled:opacity-50 disabled:cursor-not-allowed'

const SIZE_CLASSES: Record<IconButtonSize, string> = {
  sm: 'h-6 w-6',
  md: 'h-8 w-8',
  lg: 'h-10 w-10',
}

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  /** Required for a11y — icon-only controls must be named. */
  'aria-label': string
  size?: IconButtonSize
  children?: ReactNode
}

/**
 * Forward ref to the native `<button>` so caller-side refs (focus,
 * outside-click dismiss) still work without re-wiring.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    { size = 'md', className, children, ...rest },
    ref,
  ) {
    const classes = [BASE_CLASSES, SIZE_CLASSES[size], className]
      .filter(Boolean)
      .join(' ')

    return (
      <button ref={ref} className={classes} {...rest}>
        {children}
      </button>
    )
  },
)
