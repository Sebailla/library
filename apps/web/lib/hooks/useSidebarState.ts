'use client'

import { useCallback, useState } from 'react'

/**
 * `useSidebarState` — owns the boolean collapsed state of the app
 * sidebar (PR-B, REQ-MAS-007).
 *
 *   - Storage key: `alejandria.sidebar`
 *   - `'1'` → collapsed (true)
 *   - `'0'` → expanded  (false)
 *   - Absent → default expanded (false)
 *   - `toggle()` flips and persists; `set(value)` sets explicitly.
 *   - Every localStorage access is wrapped in try/catch — private-mode
 *     browsers throw on access and we MUST not crash the shell.
 *   - SSR-safe: returns the default value when `window` is undefined.
 *
 * Cross-tab sync is NOT in PR-B's scope (REQ-MAS-007 only mandates
 * persistence). Add a `storage` listener mirror of `useTheme` here in
 * a later PR if/when the user wants the same toggle behaviour in two
 * windows.
 */

const STORAGE_KEY = 'alejandria.sidebar'

function readStoredCollapsed(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function persistCollapsed(collapsed: boolean): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0')
  } catch {
    // Storage full / blocked — in-memory state still works.
  }
}

export interface UseSidebarStateResult {
  collapsed: boolean
  toggle: () => void
  set: (next: boolean) => void
}

export function useSidebarState(): UseSidebarStateResult {
  const [collapsed, setCollapsed] = useState<boolean>(readStoredCollapsed)

  const set = useCallback((next: boolean) => {
    setCollapsed(next)
    persistCollapsed(next)
  }, [])

  const toggle = useCallback(() => {
    setCollapsed((current) => {
      const next = !current
      persistCollapsed(next)
      return next
    })
  }, [])

  return { collapsed, toggle, set }
}
