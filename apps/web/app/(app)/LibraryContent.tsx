'use client'

import { useEffect, useMemo, useState } from 'react'

import { BookCard } from '@/components/BookCard'
import { Button } from '@/components/primitives/Button'
import { useSampleLibrary, type Book } from '@/lib/hooks/useSampleLibrary'

/**
 * `LibraryContent` — client-side rendering layer for the Library
 * grid (PR-C1, REQ-MLP-001 / REQ-MLP-004 / REQ-MLP-005 /
 * REQ-MLP-006).
 *
 * Receives the server-resolved initial book list plus a hint of
 * whether the dev-only auto-sample flag should fire. Behaviour:
 *
 *   - If `initialBooks.length > 0`, render the grid.
 *   - Else if `autoSampleOnEmpty` is true (dev), check
 *     `localStorage.alejandria.showSample` on mount. If unset,
 *     write `'true'` and adopt the sample dataset so a fresh
 *     DB still demos the home screen.
 *   - Otherwise render the empty state with the two CTAs.
 *
 * State: filter chip selection (`all` / `pdfs` / `epubs`) and
 * sort mode (`title-asc` / `author-asc` / `year-desc`). All
 * filtering / sorting happens client-side over the in-memory
 * array (12 books max — see REQ-MLP-001 "out of scope").
 */

type Filter = 'all' | 'pdfs' | 'epubs'
type Sort = 'title-asc' | 'author-asc' | 'year-desc'

const FILTER_LABEL: Record<Filter, string> = {
  all: 'All',
  pdfs: 'PDFs',
  epubs: 'EPUBs',
}

const SORT_LABEL: Record<Sort, string> = {
  'title-asc': 'Title (A-Z)',
  'author-asc': 'Author (A-Z)',
  'year-desc': 'Recent (year desc)',
}

function sortBooks(books: readonly Book[], sort: Sort): Book[] {
  const copy = [...books]
  switch (sort) {
    case 'title-asc':
      return copy.sort((a, b) => a.title.localeCompare(b.title))
    case 'author-asc':
      return copy.sort((a, b) => a.author.localeCompare(b.author))
    case 'year-desc':
      return copy.sort((a, b) => b.year - a.year)
  }
}

function filterBooks(books: readonly Book[], filter: Filter): Book[] {
  if (filter === 'all') return [...books]
  if (filter === 'pdfs') return books.filter((b) => b.format === 'pdf')
  return books.filter((b) => b.format === 'epub')
}

export interface LibraryContentProps {
  /** Books resolved server-side (URL `?sample=true` or real DB). */
  initialBooks: readonly Book[]
  /**
   * True in dev so an empty initial list auto-enables the sample
   * dataset via localStorage. False in production.
   */
  autoSampleOnEmpty: boolean
}

export function LibraryContent({
  initialBooks,
  autoSampleOnEmpty,
}: LibraryContentProps): React.JSX.Element {
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('year-desc')
  // `null` = "we haven't decided yet". Resolves to the actual
  // book list (possibly empty) after the localStorage effect runs.
  const [effectiveBooks, setEffectiveBooks] = useState<readonly Book[] | null>(
    initialBooks.length > 0 ? initialBooks : null,
  )

  // Auto-sample bootstrap (dev only). Reads / writes
  // `localStorage.alejandria.showSample` and adopts the sample
  // dataset when the flag is on.
  useEffect(() => {
    if (effectiveBooks !== null) return
    if (typeof window === 'undefined') return
    let active = true
    try {
      const stored = window.localStorage.getItem('alejandria.showSample')
      if (stored === 'true') {
        setEffectiveBooks(useSampleLibrary())
        return
      }
      if (autoSampleOnEmpty) {
        window.localStorage.setItem('alejandria.showSample', 'true')
        if (active) setEffectiveBooks(useSampleLibrary())
        return
      }
      if (active) setEffectiveBooks([])
    } catch {
      // localStorage may be blocked (private mode). Fall through
      // to empty state so the user still sees the CTAs.
      if (active) setEffectiveBooks([])
    }
    return () => {
      active = false
    }
  }, [autoSampleOnEmpty, effectiveBooks])

  const visibleBooks = useMemo(() => {
    if (effectiveBooks === null) return []
    return sortBooks(filterBooks(effectiveBooks, filter), sort)
  }, [effectiveBooks, filter, sort])

  // Render the empty state as soon as we know we won't auto-sample.
  if (effectiveBooks !== null && effectiveBooks.length === 0) {
    return (
      <div data-testid="library-empty-state" className="text-center py-16">
        <h2 className="text-2xl font-semibold text-[var(--color-text)]">
          Tu biblioteca está vacía
        </h2>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          Conectá tu NAS o escaneá una carpeta para empezar.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Button variant="primary">Conectar NAS</Button>
          <Button variant="secondary">Escanear carpeta</Button>
        </div>
      </div>
    )
  }

  // Initial-render placeholder while the localStorage effect runs.
  if (effectiveBooks === null) {
    return <div data-testid="library-loading" className="py-16 text-center text-sm text-[var(--color-text-muted)]">Cargando…</div>
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2" role="group" aria-label="Filter by format">
          {(['all', 'pdfs', 'epubs'] as const).map((option) => {
            const active = filter === option
            return (
              <button
                key={option}
                type="button"
                data-testid={`filter-chip-${option}`}
                aria-pressed={active}
                onClick={() => setFilter(option)}
                className={
                  active
                    ? 'rounded-[var(--radius-md)] px-3 py-1 text-sm font-medium bg-[var(--color-accent)] text-white'
                    : 'rounded-[var(--radius-md)] px-3 py-1 text-sm font-medium bg-[var(--color-surface)] text-[var(--color-text)] hover:bg-[var(--color-surface-elevated)]'
                }
              >
                {FILTER_LABEL[option]}
              </button>
            )
          })}
        </div>
        <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
          <span className="text-[var(--color-text-muted)]">Sort</span>
          <select
            data-testid="sort-dropdown"
            value={sort}
            onChange={(event) => setSort(event.target.value as Sort)}
            className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm"
          >
            {(Object.keys(SORT_LABEL) as Sort[]).map((option) => (
              <option key={option} value={option}>
                {SORT_LABEL[option]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div
        data-testid="library-grid"
        className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-6"
      >
        {visibleBooks.map((book) => (
          <BookCard key={book.id} book={book} />
        ))}
      </div>
    </div>
  )
}