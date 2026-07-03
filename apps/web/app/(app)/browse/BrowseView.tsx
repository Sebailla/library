'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

import { BookCard } from '@/components/BookCard'
import { BrowseFilters } from '@/components/BrowseFilters'
import { Button } from '@/components/primitives/Button'
import { Input } from '@/components/primitives/Input'
import type { Book } from '@/lib/hooks/useSampleLibrary'
import { useDebounced } from '@/lib/hooks/useDebounced'

import type { NasBook } from './types'

/**
 * `BrowseView` — client-side rendering layer for the Browse page
 * (PR-D1, REQ-MBP-001 / REQ-MBP-002 / REQ-MBP-003 / REQ-MBP-004 /
 * REQ-MBP-005).
 *
 * Source of truth: the URL query string.
 *
 *   - `q=<text>`        — debounced 300 ms before writing.
 *   - `category=…`      — multi-select chip row (BrowseFilters).
 *   - `format=…`        — multi-select chip row.
 *   - `lang=…`          — multi-select chip row.
 *
 * Filtering pipeline (applied on every render of `effectiveQuery`
 * or whenever the URL params change):
 *
 *   1. Match `effectiveQuery` against title or author
 *      (case-insensitive, contains).
 *   2. Keep only the categories selected in the URL (OR within).
 *   3. Keep only the formats selected in the URL.
 *   4. Keep only the languages selected in the URL.
 *
 * Empty states:
 *
 *   - If `initialNasBooks.length === 0` (no NAS connection
 *     simulated), render the "Conectá un NAS" empty state.
 *   - Else, if the filter pipeline yields zero matches, render
 *     the "no matches" empty state with a "Limpiar filtros" CTA.
 *
 * Descargar button: a no-op v1 surface. Clicking it sets the
 * `descargarToastId` state which shows a toast with the text
 * `Próximamente` and auto-dismisses after 2 s.
 */

const DEBOUNCE_MS = 300
const TOAST_MS = 2000

const CATEGORY_VALUES = ['fiction', 'non-fiction', 'science', 'tech', 'history'] as const
const FORMAT_VALUES = ['pdf', 'epub'] as const
const LANGUAGE_VALUES = ['es', 'en'] as const

type Category = (typeof CATEGORY_VALUES)[number]
type Format = (typeof FORMAT_VALUES)[number]
type Language = (typeof LANGUAGE_VALUES)[number]

function parseCsvSet<T extends string>(
  raw: string | null,
  allowed: readonly T[],
): Set<T> {
  if (raw === null) return new Set()
  const allowedSet = new Set<string>(allowed)
  const tokens = raw.split(',').map((token) => token.trim()).filter(Boolean)
  return new Set(tokens.filter((token): token is T => allowedSet.has(token)))
}

function matchesQuery(book: { title: string; author: string }, q: string): boolean {
  if (q === '') return true
  const needle = q.toLowerCase()
  return (
    book.title.toLowerCase().includes(needle) ||
    book.author.toLowerCase().includes(needle)
  )
}

function mapNasToBook(nas: NasBook): Book {
  return {
    id: nas.id,
    title: nas.title,
    author: nas.author,
    year: nas.year,
    format: nas.format,
    coverUrl: nas.coverUrl,
    lang: nas.lang,
  }
}

export interface BrowseViewProps {
  initialNasBooks: readonly NasBook[]
  initialQuery: string
}

export function BrowseView({
  initialNasBooks,
  initialQuery,
}: BrowseViewProps): React.JSX.Element {
  const router = useRouter()
  const searchParams = useSearchParams()

  // Local query — drives the input value while the user types.
  const [query, setQuery] = useState<string>(initialQuery)
  // Debounced query — drives the URL write + filter pipeline.
  const debouncedQuery = useDebounced(query, DEBOUNCE_MS)

  // Selected filters from the URL. We mirror BrowseFilters' parsing
  // so the two stay coherent on first render (the chips and the
  // grid agree on which books to show).
  const selectedCategories = useMemo(
    () => parseCsvSet<Category>(searchParams.get('category'), CATEGORY_VALUES),
    [searchParams],
  )
  const selectedFormats = useMemo(
    () => parseCsvSet<Format>(searchParams.get('format'), FORMAT_VALUES),
    [searchParams],
  )
  const selectedLanguages = useMemo(
    () => parseCsvSet<Language>(searchParams.get('lang'), LANGUAGE_VALUES),
    [searchParams],
  )

  // Sync the debounced query to the URL on change. We use
  // `router.replace` (not push) so the back button doesn't collect
  // a history entry per keystroke.
  useEffect(() => {
    if (debouncedQuery === initialQuery) return
    const params = new URLSearchParams(searchParams.toString())
    if (debouncedQuery === '') {
      params.delete('q')
    } else {
      params.set('q', debouncedQuery)
    }
    const qs = params.toString()
    router.replace(qs ? `?${qs}` : '?', { scroll: false })
    // initialQuery and searchParams are stable references within
    // a single mount; the effect should only refire when the
    // debounced value changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery])

  const visibleBooks = useMemo(() => {
    return initialNasBooks.filter((nas) => {
      if (!matchesQuery(nas, debouncedQuery)) return false
      if (selectedCategories.size > 0 && !selectedCategories.has(nas.category)) {
        return false
      }
      if (selectedFormats.size > 0 && !selectedFormats.has(nas.format)) {
        return false
      }
      if (
        selectedLanguages.size > 0 &&
        !selectedLanguages.has(nas.lang)
      ) {
        return false
      }
      return true
    })
  }, [
    initialNasBooks,
    debouncedQuery,
    selectedCategories,
    selectedFormats,
    selectedLanguages,
  ])

  // Descargar toast state. `null` → hidden; a string → the id of the
  // book whose Descargar was clicked (so the toast can announce
  // which book the user just tried to download).
  const [descargarToastId, setDescargarToastId] = useState<string | null>(null)

  useEffect(() => {
    if (descargarToastId === null) return
    const timer = window.setTimeout(() => setDescargarToastId(null), TOAST_MS)
    return () => window.clearTimeout(timer)
  }, [descargarToastId])

  function handleDescargar(bookId: string): void {
    setDescargarToastId(bookId)
  }

  function clearFilters(): void {
    router.replace('?', { scroll: false })
    setQuery('')
  }

  // Empty state: no NAS connection (initial dataset empty).
  if (initialNasBooks.length === 0) {
    return (
      <div data-testid="browse-empty-state" className="text-center py-16">
        <h2 className="text-2xl font-semibold text-[var(--color-text)]">
          Conectá un NAS para explorar el catálogo
        </h2>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          Emparejá tu dispositivo para ver los libros disponibles.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Button variant="primary">Conectar NAS</Button>
        </div>
      </div>
    )
  }

  // Empty state: filters excluded every book.
  if (visibleBooks.length === 0) {
    return (
      <div>
        <div className="mb-4">
          <Input
            data-testid="browse-search"
            placeholder="Buscar título, autor…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <BrowseFilters />
        <div data-testid="browse-empty-state" className="text-center py-16">
          <h2 className="text-2xl font-semibold text-[var(--color-text)]">
            No hay libros que coincidan con tu búsqueda
          </h2>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">
            Probá quitar filtros o cambiar la consulta.
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <Button variant="primary" onClick={clearFilters}>
              Limpiar filtros
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <h1 className="sr-only">Browse NAS catalog</h1>
      <div className="mb-4">
        <Input
          data-testid="browse-search"
          placeholder="Buscar título, autor…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="grid gap-6 md:grid-cols-[240px_1fr]">
        <BrowseFilters />
        <div
          data-testid="browse-grid"
          className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-6"
        >
          {visibleBooks.map((nas) => (
            <div key={nas.id} className="flex flex-col gap-2">
              <BookCard book={mapNasToBook(nas)} />
              <Button
                variant="secondary"
                size="sm"
                data-testid="descargar-btn"
                onClick={() => handleDescargar(nas.id)}
              >
                Descargar
              </Button>
            </div>
          ))}
        </div>
      </div>
      {descargarToastId !== null ? (
        <div
          data-testid="descargar-toast"
          role="status"
          className="fixed bottom-4 right-4 bg-[var(--color-surface-elevated)] border border-[var(--color-border)] rounded-[var(--radius-md)] px-4 py-2 shadow-[var(--shadow-lg)]"
        >
          Próximamente
        </div>
      ) : null}
    </div>
  )
}