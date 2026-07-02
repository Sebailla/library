'use client'

import { useRouter } from 'next/navigation'

/**
 * `SearchHint` — the "🔍 Search ⌘K" trigger button inside the Topbar
 * (PR-B, REQ-MAS-003).
 *
 * Per REQ-MAS-006 the keyboard chord ⌘K focuses global search; in v1
 * this means routing to `/search`, where the page autofocuses its
 * input. We navigate on click AND on ⌘K so the click is consistent
 * with the keyboard path.
 *
 * The `data-testid="search-trigger"` seam is what
 * `useGlobalShortcuts` checks via `document.activeElement.closest(...)`
 * — when focus is on this button (or one of its descendants) and the
 * user presses ⌘K, the hook navigates to `/search` instead of
 * re-focusing.
 *
 * The `no-drag` class opts the button out of the OS-level drag region
 * so a click does NOT start a window-drag gesture in Electron.
 */

export function SearchHint(): React.JSX.Element {
  const router = useRouter()

  return (
    <button
      type="button"
      data-testid="search-trigger"
      onClick={() => router.push('/search')}
      className="no-drag inline-flex items-center gap-2 rounded-[var(--radius-md)] px-3 py-1.5 text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-surface)]"
    >
      <span aria-hidden="true">🔍</span>
      <span>Search</span>
      <kbd className="ml-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 text-xs text-[var(--color-text-muted)]">
        ⌘K
      </kbd>
    </button>
  )
}
