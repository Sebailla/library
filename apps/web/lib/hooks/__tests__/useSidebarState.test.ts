import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'

/**
 * TDD — RED phase for `lib/hooks/useSidebarState.ts` (PR-B, REQ-MAS-007).
 *
 * Contract:
 *
 *   - Reads `localStorage['alejandria.sidebar']` on first render.
 *     `'1'` → collapsed; `'0'` → expanded. Absent → defaults to expanded.
 *   - `toggle()` flips the boolean and persists.
 *   - `set(value)` sets explicitly and persists.
 *   - SSR-safe (does NOT throw when `window` is undefined).
 *
 * The hook is a private UI-state primitive — no cross-tab sync in
 * PR-B (the spec only mandates persistence). A future PR could add a
 * `storage` listener mirror of `useTheme`.
 */

import { useSidebarState } from '../useSidebarState'

const STORAGE_KEY = 'alejandria.sidebar'

function setStored(value: '0' | '1' | null): void {
  if (value === null) {
    window.localStorage.removeItem(STORAGE_KEY)
  } else {
    window.localStorage.setItem(STORAGE_KEY, value)
  }
}

describe('useSidebarState (PR-B, REQ-MAS-007)', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    window.localStorage.clear()
  })

  it('defaults to expanded when localStorage is empty', () => {
    setStored(null)
    const { result } = renderHook(() => useSidebarState())

    expect(result.current.collapsed).toBe(false)
  })

  it('reads "1" from localStorage as collapsed', () => {
    setStored('1')
    const { result } = renderHook(() => useSidebarState())

    expect(result.current.collapsed).toBe(true)
  })

  it('reads "0" from localStorage as expanded', () => {
    setStored('0')
    const { result } = renderHook(() => useSidebarState())

    expect(result.current.collapsed).toBe(false)
  })

  it('toggle() flips expanded → collapsed and persists "1"', () => {
    setStored(null)
    const { result } = renderHook(() => useSidebarState())

    expect(result.current.collapsed).toBe(false)

    act(() => {
      result.current.toggle()
    })

    expect(result.current.collapsed).toBe(true)
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('1')
  })

  it('toggle() flips collapsed → expanded and persists "0"', () => {
    setStored('1')
    const { result } = renderHook(() => useSidebarState())

    expect(result.current.collapsed).toBe(true)

    act(() => {
      result.current.toggle()
    })

    expect(result.current.collapsed).toBe(false)
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('0')
  })

  it('set(true) sets collapsed and persists "1"', () => {
    setStored(null)
    const { result } = renderHook(() => useSidebarState())

    act(() => {
      result.current.set(true)
    })

    expect(result.current.collapsed).toBe(true)
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('1')
  })

  it('set(false) sets expanded and persists "0"', () => {
    setStored('1')
    const { result } = renderHook(() => useSidebarState())

    act(() => {
      result.current.set(false)
    })

    expect(result.current.collapsed).toBe(false)
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('0')
  })
})
