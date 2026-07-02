'use client'

import { usePathname } from 'next/navigation'

import { SearchHint } from './SearchHint'
import { ThemeToggle } from './ThemeToggle'

/**
 * `Topbar` — 52px-tall header that sits above the main content slot
 * (PR-B, REQ-MAS-003 / REQ-MCL-005).
 *
 *   - Root has the `drag-region` utility class from `globals.css` so
 *     the OS window can be dragged from any non-interactive area in
 *     Electron. Buttons inside opt out with `no-drag` so clicks land
 *     on the button and not a drag gesture.
 *   - Three slots: left (route label), right (SearchHint), far-right
 *     (ThemeToggle).
 *   - The route label is a static map for the four known app routes.
 *     `/reader/[id]` collapses to "Reader" — the rest share labels.
 */

const ROUTE_LABELS: ReadonlyArray<{ prefix: string; label: string }> = [
  { prefix: '/reader', label: 'Reader' },
  { prefix: '/search', label: 'Search' },
  { prefix: '/browse', label: 'Browse' },
  { prefix: '/', label: 'Library' },
]

function labelForPath(pathname: string): string {
  for (const entry of ROUTE_LABELS) {
    if (entry.prefix === '/') {
      if (pathname === '/') return entry.label
      continue
    }
    if (pathname === entry.prefix || pathname.startsWith(entry.prefix + '/')) {
      return entry.label
    }
  }
  return 'Library'
}

export function Topbar(): React.JSX.Element {
  const pathname = usePathname() ?? '/'

  return (
    <header
      data-testid="topbar"
      className="drag-region flex h-[52px] items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-bg)] px-4"
    >
      <div className="no-drag text-sm font-semibold text-[var(--color-text)]">
        {labelForPath(pathname)}
      </div>
      <div className="flex items-center gap-2">
        <SearchHint />
        <ThemeToggle />
      </div>
    </header>
  )
}
