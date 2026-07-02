import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

/**
 * TDD — RED phase for `lib/hooks/useTheme.ts` (PR-A, REQ-MVF-007).
 *
 * The hook owns:
 *   - the current theme ('light' | 'dark')
 *   - initial value from `localStorage['alejandria.theme']`, falling back
 *     to `window.matchMedia('(prefers-color-scheme: dark)')` when absent
 *   - `setTheme(t)` — persists to localStorage AND writes `data-theme`
 *     on `document.documentElement`
 *   - `toggle()` — flips light ↔ dark via `setTheme`
 *   - cross-tab `storage` event listener — picks up another tab's change
 *   - SSR safety — does NOT throw when `window` is undefined
 *
 * Triangulation cases per the spec (initial / explicit / fallback / cross-tab).
 */

import { useTheme } from '../useTheme'

type Theme = 'light' | 'dark'

const STORAGE_KEY = 'alejandria.theme'

function setStored(value: Theme | null): void {
  if (value === null) {
    window.localStorage.removeItem(STORAGE_KEY)
  } else {
    window.localStorage.setItem(STORAGE_KEY, value)
  }
}

function setPrefersDark(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

describe('useTheme (PR-A, REQ-MVF-007)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    setPrefersDark(false)
  })

  afterEach(() => {
    window.localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })

  it('returns light theme + setTheme when localStorage is empty and OS prefers light', () => {
    setStored(null)
    setPrefersDark(false)

    const { result } = renderHook(() => useTheme())

    expect(result.current.theme).toBe('light')
    expect(typeof result.current.setTheme).toBe('function')
    expect(typeof result.current.toggle).toBe('function')
  })

  it('falls back to prefers-color-scheme: dark when localStorage is empty', () => {
    setStored(null)
    setPrefersDark(true)

    const { result } = renderHook(() => useTheme())

    expect(result.current.theme).toBe('dark')
  })

  it('reads the stored value when localStorage has it, ignoring prefers-color-scheme', () => {
    setStored('light')
    setPrefersDark(true)

    const { result } = renderHook(() => useTheme())

    expect(result.current.theme).toBe('light')
  })

  it('setTheme("dark") persists to localStorage and writes data-theme="dark" on <html>', () => {
    setStored(null)
    setPrefersDark(false)
    const { result } = renderHook(() => useTheme())

    act(() => {
      result.current.setTheme('dark')
    })

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(result.current.theme).toBe('dark')
  })

  it('setTheme("light") overwrites a previously stored "dark" value', () => {
    setStored('dark')
    setPrefersDark(false)
    const { result } = renderHook(() => useTheme())

    act(() => {
      result.current.setTheme('light')
    })

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(result.current.theme).toBe('light')
  })

  it('toggle() flips light → dark and back', () => {
    setStored(null)
    setPrefersDark(false)
    const { result } = renderHook(() => useTheme())

    expect(result.current.theme).toBe('light')

    act(() => {
      result.current.toggle()
    })
    expect(result.current.theme).toBe('dark')
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')

    act(() => {
      result.current.toggle()
    })
    expect(result.current.theme).toBe('light')
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('light')
  })

  it('updates state when a "storage" event from another tab toggles the key', () => {
    setStored(null)
    setPrefersDark(false)
    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('light')

    act(() => {
      // Simulate another tab writing 'dark' to localStorage. The event
      // payload uses the SAME key the hook listens on.
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: STORAGE_KEY,
          newValue: 'dark',
          oldValue: null,
          storageArea: window.localStorage,
        }),
      )
    })

    expect(result.current.theme).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })
})