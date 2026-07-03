'use client'

import { useEffect, useState } from 'react'

/**
 * `useDebounced` — generic debounce primitive for value updates
 * (PR-D1, REQ-MBP-001 / REQ-MSP-002).
 *
 *   - Returns the input value as-is until `delayMs` of quiet elapses
 *     after the LAST change.
 *   - Changes inside the quiet window cancel the previous timer
 *     (React effect cleanup) so intermediate values never surface.
 *   - Unmount cancels the pending timer — no late state update on
 *     an unmounted component.
 *   - SSR-safe: when `window` is undefined (server render), the
 *     hook simply returns the initial value. The effect re-arms on
 *     hydration.
 *
 * Used by the Browse search input (300 ms) and the Search page
 * input (300 ms) to coalesce keystrokes before they hit the URL.
 * The hook is intentionally tiny — callers do the URL write, the
 * grid re-renders, etc. Keeping the hook value-only means it is
 * composable with anything (search inputs, sliders, autocompletes).
 */

export function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const timer = window.setTimeout(() => {
      setDebounced(value)
    }, delayMs)
    return () => {
      window.clearTimeout(timer)
    }
  }, [value, delayMs])

  return debounced
}