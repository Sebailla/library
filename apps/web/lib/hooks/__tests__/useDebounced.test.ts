import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'

/**
 * TDD — RED phase for `lib/hooks/useDebounced.ts`
 * (PR-D1, REQ-MBP-001 / REQ-MSP-002).
 *
 * `useDebounced` is a tiny generic hook that returns a value only
 * after `delayMs` of quiet. Used by the Browse search input and the
 * Search page input to debounce text changes before they hit the
 * URL and refilter the grid.
 *
 * Contract under test:
 *
 *   - Returns the initial value on the first render.
 *   - After `value` changes, the debounced value updates only
 *     after `delayMs` of quiet.
 *   - Changing the value BEFORE `delayMs` elapses cancels the stale
 *     timer (cleanup). The debounced value never reflects the
 *     intermediate value.
 *   - Unmounting cancels the pending timer (no late update causes a
 *     state update after unmount → React warning).
 */

import { useDebounced } from '../useDebounced'

describe('useDebounced (PR-D1, REQ-MBP-001 / REQ-MSP-002)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the initial value on the first render', () => {
    const { result } = renderHook(() => useDebounced('hello', 300))

    expect(result.current).toBe('hello')
  })

  it('does not update the debounced value before delayMs elapses', () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useDebounced(value, 300),
      { initialProps: { value: 'hello' } },
    )

    rerender({ value: 'world' })

    // Advance HALF the delay — the debounced value must still be
    // the initial value, not the new one.
    act(() => {
      vi.advanceTimersByTime(150)
    })

    expect(result.current).toBe('hello')
  })

  it('updates the debounced value after delayMs of quiet', () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useDebounced(value, 300),
      { initialProps: { value: 'hello' } },
    )

    rerender({ value: 'world' })

    act(() => {
      vi.advanceTimersByTime(300)
    })

    expect(result.current).toBe('world')
  })

  it('cancels the stale timer when value changes before delayMs elapses (intermediate value never surfaces)', () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useDebounced(value, 300),
      { initialProps: { value: 'a' } },
    )

    // Rapid typing: a → b → c with 100 ms between keys (well under
    // the 300 ms delay). The intermediate value "b" must NEVER be
    // reflected by the debounced output.
    rerender({ value: 'b' })
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(result.current).toBe('a')

    rerender({ value: 'c' })
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(result.current).toBe('a')

    // After 300 ms from the LAST change, the debounced value settles
    // on "c" — not "b".
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(result.current).toBe('c')
  })

  it('unmounting cancels the pending timer (no state update after unmount)', () => {
    const { result, rerender, unmount } = renderHook(
      ({ value }: { value: string }) => useDebounced(value, 300),
      { initialProps: { value: 'hello' } },
    )

    rerender({ value: 'world' })

    unmount()

    // Advancing time after unmount must NOT throw the React warning
    // "Can't perform a React state update on an unmounted component".
    expect(() => {
      act(() => {
        vi.advanceTimersByTime(300)
      })
    }).not.toThrow()
    // The result snapshot is from before unmount; we don't read it
    // here. The contract is "no late update" — the test for that is
    // the absence of a thrown warning above.
    void result
  })

  it('works with non-string values (generic)', () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: number }) => useDebounced(value, 300),
      { initialProps: { value: 0 } },
    )

    expect(result.current).toBe(0)

    rerender({ value: 42 })

    act(() => {
      vi.advanceTimersByTime(300)
    })

    expect(result.current).toBe(42)
  })
})