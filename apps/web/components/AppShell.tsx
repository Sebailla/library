'use client'

import { useCallback, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'

import { Sidebar, type SidebarItem } from './Sidebar'
import { Topbar } from './Topbar'
import { useGlobalShortcuts } from '@/lib/hooks/useGlobalShortcuts'
import { useSidebarState } from '@/lib/hooks/useSidebarState'

/**
 * `AppShell` — persistent client-side chrome that wraps every
 * authenticated route (PR-B, REQ-MAS-001).
 *
 *   - Three slots: Sidebar (left rail) + Topbar (header) + `<main>`
 *     (page content).
 *   - Owns `useSidebarState()` — sidebar collapsed/expanded, persisted
 *     to `localStorage['alejandria.sidebar']` (REQ-MAS-007).
 *   - Wires `useGlobalShortcuts` so ⌘B toggles the sidebar and ⌘K
 *     routes to `/search` (or focuses the trigger if it's elsewhere).
 *   - `useTheme()` is implicitly mounted by the `ThemeToggle` rendered
 *     inside `Topbar` — no need to re-mount here.
 *
 * Sidebar items are an internal constant in v1 (Library / Browse /
 * Search / [future] disabled). The four slots match REQ-MAS-001's
 * page list and keep the shell self-contained.
 */

const SIDEBAR_ITEMS: SidebarItem[] = [
  { href: '/', label: 'Library', icon: <span aria-hidden="true">📚</span> },
  { href: '/browse', label: 'Browse', icon: <span aria-hidden="true">🧭</span> },
  { href: '/search', label: 'Search', icon: <span aria-hidden="true">🔍</span> },
  {
    href: '/future',
    label: 'Coming soon',
    icon: <span aria-hidden="true">✨</span>,
    disabled: true,
  },
]

export interface AppShellProps {
  children: ReactNode
}

export function AppShell({ children }: AppShellProps): React.JSX.Element {
  const router = useRouter()
  const { collapsed, toggle } = useSidebarState()

  // ⌘K / Ctrl+K short-circuit: the global search in v1 lives on
  // `/search`. The `useGlobalShortcuts` hook checks whether the
  // search-trigger button is already focused and, if not, calls
  // `onFocusSearch` — which we implement here as "navigate to
  // /search" so the keyboard path matches the click path. The
  // search page's input autofocuses on mount.
  const focusSearch = useCallback(() => {
    router.push('/search')
  }, [router])

  useGlobalShortcuts({
    onToggleSidebar: toggle,
    onFocusSearch: focusSearch,
  })

  return (
    <div className="flex h-screen w-screen">
      <Sidebar
        items={SIDEBAR_ITEMS}
        collapsed={collapsed}
        onToggleCollapsed={toggle}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  )
}
