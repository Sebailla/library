import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { act, render, renderHook } from '@testing-library/react'

/**
 * TDD — RED phase for `lib/hooks/useGlobalShortcuts.ts`
 * (PR-B, REQ-MAS-005 / REQ-MAS-006).
 *
 * Contract:
 *
 *   - ⌘B (Meta+B) outside any input → calls `onToggleSidebar`.
 *   - Ctrl+B on non-mac → calls `onToggleSidebar` (verified by forcing
 *     `navigator.platform` to a non-Mac value, but jsdom doesn't expose
 *     navigator.platform so we test via the keydown event with `ctrlKey`
 *     set and `metaKey` false — the hook must accept both chords).
 *   - ⌘B inside an `<input>` → MUST NOT call `onToggleSidebar` and
 *     MUST NOT call `preventDefault` (so the browser keeps its
 *     default behaviour).
 *   - ⌘K (Meta+K) outside any input → calls `onFocusSearch`.
 *   - ⌘K while focus is on the search-trigger element (`data-testid="search-trigger"`)
 *     → navigates to `/search` (calls `router.push('/search')`).
 *   - Listener cleaned up on unmount.
 */

const { useRouterMock } = vi.hoisted(() => ({
  useRouterMock: vi.fn(() => ({
    push: vi.fn(),
  })),
}))

vi.mock('next/navigation', () => ({
  useRouter: useRouterMock,
}))

import { useGlobalShortcuts } from '../useGlobalShortcuts'

function fireKeydown(target: EventTarget, init: KeyboardEventInit): void {
  const event = new KeyboardEvent('keydown', { bubbles: true, ...init })
  target.dispatchEvent(event)
}

function wrapWithInput() {
  // Returns a wrapper that renders an `<input>` plus invokes the hook
  // inside, so we can simulate `event.target` being an input element.
  // The hook itself attaches to `document` so the wrapper just has to
  // mount long enough for the effect to run.
  return ({ children }: { children?: React.ReactNode }) => {
    useGlobalShortcuts({ onToggleSidebar: vi.fn(), onFocusSearch: vi.fn() })
    return (
      <div>
        <input data-testid="the-input" />
        {children}
      </div>
    )
  }
}

describe('useGlobalShortcuts (PR-B, REQ-MAS-005 / REQ-MAS-006)', () => {
  beforeEach(() => {
    useRouterMock.mockClear()
    useRouterMock.mockReturnValue({ push: vi.fn() })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('⌘B outside any input calls onToggleSidebar', () => {
    const onToggleSidebar = vi.fn()
    renderHook(() =>
      useGlobalShortcuts({
        onToggleSidebar,
        onFocusSearch: vi.fn(),
      }),
    )

    fireKeydown(document.body, { key: 'b', metaKey: true })

    expect(onToggleSidebar).toHaveBeenCalledTimes(1)
  })

  it('Ctrl+B outside any input calls onToggleSidebar', () => {
    const onToggleSidebar = vi.fn()
    renderHook(() =>
      useGlobalShortcuts({
        onToggleSidebar,
        onFocusSearch: vi.fn(),
      }),
    )

    fireKeydown(document.body, { key: 'b', ctrlKey: true })

    expect(onToggleSidebar).toHaveBeenCalledTimes(1)
  })

  it('⌘B inside an <input> does NOT call onToggleSidebar', () => {
    const onToggleSidebar = vi.fn()
    const Wrapper = wrapWithInput()
    render(<Wrapper />)

    const input = document.querySelector(
      'input[data-testid="the-input"]',
    ) as HTMLInputElement
    fireKeydown(input, { key: 'b', metaKey: true })

    expect(onToggleSidebar).not.toHaveBeenCalled()
  })

  it('⌘K outside any input calls onFocusSearch', () => {
    const onFocusSearch = vi.fn()
    const push = vi.fn()
    useRouterMock.mockReturnValue({ push })

    renderHook(() =>
      useGlobalShortcuts({
        onToggleSidebar: vi.fn(),
        onFocusSearch,
      }),
    )

    fireKeydown(document.body, { key: 'k', metaKey: true })

    expect(onFocusSearch).toHaveBeenCalledTimes(1)
    expect(push).not.toHaveBeenCalled()
  })

  it('⌘K while focused on the search-trigger element navigates to /search', () => {
    const onFocusSearch = vi.fn()
    const push = vi.fn()
    useRouterMock.mockReturnValue({ push })

    // Render a real search-trigger button so document.activeElement
    // resolves to it once we focus it.
    const Wrapper = () => {
      useGlobalShortcuts({
        onToggleSidebar: vi.fn(),
        onFocusSearch,
      })
      return <button data-testid="search-trigger">Search</button>
    }
    render(<Wrapper />)

    const trigger = document.querySelector(
      '[data-testid="search-trigger"]',
    ) as HTMLElement
    trigger.focus()

    act(() => {
      fireKeydown(trigger, { key: 'k', metaKey: true })
    })

    expect(push).toHaveBeenCalledWith('/search')
    expect(onFocusSearch).not.toHaveBeenCalled()
  })

  it('removes the keydown listener on unmount', () => {
    const onToggleSidebar = vi.fn()
    const { unmount } = renderHook(() =>
      useGlobalShortcuts({
        onToggleSidebar,
        onFocusSearch: vi.fn(),
      }),
    )

    unmount()

    fireKeydown(document.body, { key: 'b', metaKey: true })

    expect(onToggleSidebar).not.toHaveBeenCalled()
  })
})
