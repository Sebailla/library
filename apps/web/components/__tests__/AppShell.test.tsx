import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'

/**
 * TDD — GREEN test for `components/AppShell.tsx` (PR-B, REQ-MAS-001
 * / REQ-MAS-004 / REQ-MAS-005 / REQ-MAS-007).
 *
 * Single file covers the integration of Sidebar + Topbar + ThemeToggle
 * + the keyboard shortcut wiring. Higher-level AppShell assertions:
 *
 *   - Sidebar + Topbar + content slot all render.
 *   - On `/browse`, the Browse sidebar item has `aria-current="page"`.
 *   - On `/reader/abc`, no sidebar item is active (Reader is NOT in
 *     the v1 sidebar — BookCard navigates into the reader route
 *     outside the rail).
 *   - Pressing ⌘B on the document collapses the sidebar.
 *   - The new state persists to `localStorage['alejandria.sidebar']`.
 */

const { usePathnameMock } = vi.hoisted(() => ({
  usePathnameMock: vi.fn(() => '/'),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: usePathnameMock,
}))

import { AppShell } from '../AppShell'

const SIDEBAR_KEY = 'alejandria.sidebar'

describe('AppShell (PR-B, REQ-MAS-001 / REQ-MAS-004 / REQ-MAS-005)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    usePathnameMock.mockReturnValue('/')
  })

  afterEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('renders the sidebar, the topbar, and the content slot', () => {
    render(
      <AppShell>
        <div data-testid="content">x</div>
      </AppShell>,
    )

    expect(screen.getByTestId('sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('topbar')).toBeInTheDocument()
    expect(screen.getByTestId('content')).toBeInTheDocument()
  })

  it('marks the Browse sidebar item with aria-current="page" when pathname is /browse', () => {
    usePathnameMock.mockReturnValue('/browse')

    render(
      <AppShell>
        <div data-testid="content">x</div>
      </AppShell>,
    )

    const browseLink = screen.getByTestId('sidebar-item-browse')
    expect(browseLink).toHaveAttribute('aria-current', 'page')
  })

  it('does not mark any sidebar item active when pathname is /reader/abc', () => {
    usePathnameMock.mockReturnValue('/reader/abc')

    render(
      <AppShell>
        <div data-testid="content">x</div>
      </AppShell>,
    )

    // Reader is opened via BookCard click — not present in the v1
    // sidebar list. No item should claim aria-current="page".
    const items = document.querySelectorAll('[data-testid^="sidebar-item-"]')
    items.forEach((item) => {
      expect(item).not.toHaveAttribute('aria-current', 'page')
    })
  })

  it('⌘B keydown on the document collapses the sidebar', () => {
    usePathnameMock.mockReturnValue('/')
    render(
      <AppShell>
        <div data-testid="content">x</div>
      </AppShell>,
    )

    // Sidebar starts expanded (no localStorage entry).
    const sidebar = screen.getByTestId('sidebar')
    expect(sidebar.className).toContain('w-60')

    act(() => {
      fireEvent.keyDown(document.body, { key: 'b', metaKey: true })
    })

    expect(screen.getByTestId('sidebar').className).toContain('w-16')
  })

  it('persists the new sidebar state to localStorage after ⌘B', () => {
    usePathnameMock.mockReturnValue('/')
    render(
      <AppShell>
        <div data-testid="content">x</div>
      </AppShell>,
    )

    act(() => {
      fireEvent.keyDown(document.body, { key: 'b', metaKey: true })
    })

    expect(window.localStorage.getItem(SIDEBAR_KEY)).toBe('1')
  })
})
