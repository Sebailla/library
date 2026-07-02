'use client'

import { useTheme } from '@/lib/hooks/useTheme'
import { IconButton } from './primitives/IconButton'

/**
 * `ThemeToggle` — Sun/Moon icon button that flips the global theme
 * via `useTheme()` (PR-B, REQ-MAS-003 / REQ-MVF-007).
 *
 *   - `role="switch"` + `aria-checked` reflect the current theme
 *     (true when dark).
 *   - `aria-label` describes the ACTION ("Switch to dark mode" when
 *     currently light, etc.) so screen readers announce what clicking
 *     the button does.
 *   - Uses the `IconButton` primitive so the hit-target + a11y
 *     contracts are inherited.
 *   - Glyph is a single emoji for v1 (☀ / 🌙) — keeps the PR tight
 *     without pulling in an icon dependency.
 */

export function ThemeToggle(): React.JSX.Element {
  const { theme, toggle } = useTheme()
  const isDark = theme === 'dark'

  return (
    <IconButton
      role="switch"
      aria-checked={isDark}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      data-testid="theme-toggle"
      onClick={toggle}
      size="md"
    >
      <span aria-hidden="true">{isDark ? '🌙' : '☀'}</span>
    </IconButton>
  )
}
