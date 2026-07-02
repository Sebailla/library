'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * `useTheme` — owns the current `'light' | 'dark'` theme for the app
 * (PR-A, REQ-MVF-004 + REQ-MVF-007).
 *
 * Behavior contract:
 *
 *   1. Initial value is read from `localStorage['alejandria.theme']`. If
 *      no entry exists, we fall back to `prefers-color-scheme: dark`.
 *
 *   2. Every state change writes the new value back to localStorage AND
 *      sets `data-theme` on `document.documentElement` so the CSS
 *      `@theme` / `html[data-theme="dark"]` blocks flip immediately.
 *
 *   3. A `storage` event listener (added in `useEffect`) keeps the hook
 *      in sync with another tab that toggled the key — same browser,
 *      same localStorage, different document context.
 *
 *   4. SSR-safe: when `window` is undefined we return the default theme
 *      and no-op the setters. The inline boot script in
 *      `app/layout.tsx` writes `data-theme` on the server-rendered HTML
 *      before hydration so the first paint matches.
 *
 *   5. Every `localStorage` access is wrapped in try/catch — a private-
 *      mode browser that throws on access must not crash the app.
 */

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'alejandria.theme'
const DEFAULT_THEME: Theme = 'light'

function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark'
}

/** Resolve the initial theme from window state. Safe to call server-side. */
function resolveInitial(): Theme {
  if (typeof window === 'undefined') return DEFAULT_THEME
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (isTheme(stored)) return stored
  } catch {
    // localStorage can throw in private-mode or sandboxed contexts.
    // Fall through to the OS preference probe.
  }
  try {
    if (
      window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
    ) {
      return 'dark'
    }
  } catch {
    // matchMedia can throw on stripped-down test envs — ignore.
  }
  return DEFAULT_THEME
}

/** Apply the theme to `documentElement` — DOM side effect, never run SSR. */
function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', theme)
}

/** Persist to localStorage. Wrapped because private mode can throw. */
function persistTheme(theme: Theme): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // Storage full / blocked — ignore; in-memory state still works.
  }
}

export interface UseThemeResult {
  /** Current applied theme. */
  theme: Theme
  /** Set an explicit theme. Persists + applies to `<html data-theme>`. */
  setTheme: (next: Theme) => void
  /** Flip light ↔ dark. */
  toggle: () => void
}

export function useTheme(): UseThemeResult {
  // `resolveInitial()` runs during the first render. SSR is safe because
  // it returns `DEFAULT_THEME` when `window` is undefined.
  const [theme, setThemeState] = useState<Theme>(resolveInitial)

  // On mount + on every change, sync DOM + storage. Runs only client-side
  // (useEffect never fires on the server) so DOM access is safe.
  useEffect(() => {
    applyTheme(theme)
    persistTheme(theme)
  }, [theme])

  // Cross-tab sync — another tab calls `setTheme` → storage event fires
  // here → we update React state. Cleans up on unmount.
  useEffect(() => {
    if (typeof window === 'undefined') return
    function onStorage(event: StorageEvent): void {
      if (event.key !== STORAGE_KEY) return
      if (!isTheme(event.newValue)) return
      setThemeState(event.newValue)
    }
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
  }, [])

  const toggle = useCallback(() => {
    setThemeState((current) => (current === 'dark' ? 'light' : 'dark'))
  }, [])

  return { theme, setTheme, toggle }
}