'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

import { IconButton } from './primitives/IconButton'

/**
 * `Sidebar` — persistent vertical nav rail on the left edge of the
 * app shell (PR-B, REQ-MAS-002 / REQ-MAS-004 / REQ-MCL-004).
 *
 *   - Width: 240 expanded / 64 collapsed (matches REQ-MAS-002).
 *   - Items array is caller-driven so the AppShell decides what
 *     entries to show (Library / Browse / Search / [future] disabled).
 *   - Active state derived from `usePathname()`: exact match OR prefix
 *     match (`pathname.startsWith(href + '/')`) so a nested route like
 *     `/browse/featured` still highlights Browse.
 *   - When `collapsed` is true, the label `<span>` becomes
 *     `sr-only` (still announced by screen readers) and the icon
 *     stays visible.
 *   - Disabled items render as a non-link `<span>` with
 *     `aria-disabled="true"` and `opacity-50 cursor-not-allowed` —
 *     a real button would steal focus from a11y tree walks.
 *   - The wordmark "Alejandría" only shows when expanded (collapsed
 *     state keeps the rail icon-only).
 *
 * `IconButton` (from PR-B primitives) is used for the collapse toggle
 * at the bottom of the rail — the icon is a simple chevron character
 * to avoid pulling in an icon dependency in v1.
 */

export interface SidebarItem {
  href: string
  label: string
  icon: ReactNode
  disabled?: boolean
}

export interface SidebarProps {
  items: SidebarItem[]
  collapsed: boolean
  onToggleCollapsed: () => void
}

function isItemActive(itemHref: string, pathname: string): boolean {
  if (itemHref === '/') return pathname === '/'
  return pathname === itemHref || pathname.startsWith(itemHref + '/')
}

export function Sidebar({
  items,
  collapsed,
  onToggleCollapsed,
}: SidebarProps): React.JSX.Element {
  const pathname = usePathname() ?? ''

  return (
    <aside
      data-testid="sidebar"
      aria-label="Primary navigation"
      className={`flex h-full flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)] transition-[width] duration-200 ${
        collapsed ? 'w-16' : 'w-60'
      }`}
    >
      <div
        className={`flex h-[52px] items-center border-b border-[var(--color-border)] px-3 ${
          collapsed ? 'justify-center' : 'justify-start'
        }`}
      >
        <span
          className={`text-sm font-semibold tracking-tight text-[var(--color-text)] ${
            collapsed ? 'sr-only' : ''
          }`}
        >
          Alejandría
        </span>
      </div>

      <nav className="flex-1 overflow-y-auto p-2">
        <ul className="flex flex-col gap-1">
          {items.map((item) => {
            const active = !item.disabled && isItemActive(item.href, pathname)

            const baseClass =
              'no-drag flex items-center gap-2 rounded-[var(--radius-md)] px-2.5 py-2 text-sm transition-colors'
            const stateClass = active
              ? 'bg-[var(--color-surface-elevated)] text-[var(--color-accent)]'
              : 'text-[var(--color-text)] hover:bg-[var(--color-surface-elevated)]'

            const content = (
              <>
                <span aria-hidden="true" className="inline-flex shrink-0">
                  {item.icon}
                </span>
                <span className={collapsed ? 'sr-only' : ''}>{item.label}</span>
              </>
            )

            return (
              <li key={item.href}>
                {item.disabled ? (
                  <span
                    aria-disabled="true"
                    className={`${baseClass} ${stateClass} opacity-50 cursor-not-allowed`}
                  >
                    {content}
                  </span>
                ) : (
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    data-testid={`sidebar-item-${item.href === '/' ? 'home' : item.href.slice(1)}`}
                    className={`${baseClass} ${stateClass}`}
                  >
                    {content}
                  </Link>
                )}
              </li>
            )
          })}
        </ul>
      </nav>

      <div className="border-t border-[var(--color-border)] p-2">
        <IconButton
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          data-testid="sidebar-toggle"
          size="md"
          onClick={onToggleCollapsed}
          className="w-full"
        >
          {collapsed ? '›' : '‹'}
        </IconButton>
      </div>
    </aside>
  )
}
