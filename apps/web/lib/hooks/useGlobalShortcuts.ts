'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * `useGlobalShortcuts` — installs document-level keyboard shortcuts
 * for the global app shell (PR-B, REQ-MAS-005 / REQ-MAS-006).
 *
 *   - ⌘B (Meta+B) and Ctrl+B → `onToggleSidebar` (no-op when focus
 *     is inside an input/textarea/contentEditable element).
 *   - ⌘K (Meta+K) and Ctrl+K → if the active element is inside the
 *     search-trigger region (`data-testid="search-trigger"`), the
 *     router pushes `/search` (the Search page autofocuses its
 *     input on mount per Open decision #2). Otherwise
 *     `onFocusSearch` is called so a future search modal can focus
 *     itself in-place.
 *
 *   - The listener is attached in `useEffect` and removed on cleanup,
 *     so unmounting the consumer removes the global handler.
 *   - We use `event.target instanceof HTMLInputElement / HTMLTextAreaElement`
 *     for the input check; for `[contenteditable]` we fall back to a
 *     string check on `isContentEditable`. This matches REQ-MAS-005
 *     which lists all three.
 */

const SEARCH_TRIGGER_SELECTOR = '[data-testid="search-trigger"]'

export interface UseGlobalShortcutsArgs {
  onToggleSidebar: () => void
  onFocusSearch: () => void
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target instanceof HTMLInputElement) return true
  if (target instanceof HTMLTextAreaElement) return true
  if (target.isContentEditable) return true
  return false
}

function isSearchTriggerActive(): boolean {
  if (typeof document === 'undefined') return false
  const active = document.activeElement
  if (!(active instanceof HTMLElement)) return false
  if (active.matches(SEARCH_TRIGGER_SELECTOR)) return true
  return active.closest(SEARCH_TRIGGER_SELECTOR) !== null
}

export function useGlobalShortcuts({
  onToggleSidebar,
  onFocusSearch,
}: UseGlobalShortcutsArgs): void {
  const router = useRouter()

  useEffect(() => {
    if (typeof document === 'undefined') return

    function handleKeydown(event: KeyboardEvent): void {
      const isToggleChord =
        (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey
      if (!isToggleChord) return

      if (event.key === 'b' || event.key === 'B') {
        if (isEditableTarget(event.target)) return
        event.preventDefault()
        onToggleSidebar()
        return
      }

      if (event.key === 'k' || event.key === 'K') {
        if (isSearchTriggerActive()) {
          event.preventDefault()
          router.push('/search')
        } else {
          event.preventDefault()
          onFocusSearch()
        }
      }
    }

    document.addEventListener('keydown', handleKeydown)
    return () => {
      document.removeEventListener('keydown', handleKeydown)
    }
  }, [onToggleSidebar, onFocusSearch, router])
}
