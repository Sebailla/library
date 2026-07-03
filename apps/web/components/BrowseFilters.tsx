'use client'

import { useRouter, useSearchParams } from 'next/navigation'

/**
 * `BrowseFilters` — left sidebar with three chip rows that drive
 * the Browse grid (PR-D1, REQ-MBP-002).
 *
 *   - Category: fiction / non-fiction / science / tech / history
 *   - Format:   pdf / epub
 *   - Language: es / en
 *
 *   - Multi-select within a section is OR; across sections is AND.
 *   - State is held in the URL query string (`?category=…&format=…&lang=…`)
 *     so the page is shareable + refresh-safe. We update the URL
 *     via `router.replace(\`?\${params.toString()}\`, { scroll: false })`
 *     — replace, not push, so the back button does not collect a
 *     history entry per chip click.
 *   - Invalid values (anything outside the canonical chip set) are
 *     coerced to "all" by `getActiveSet` so a stale bookmark with
 *     `?format=docx` simply renders no format chip pressed.
 *   - `data-testid="filter-{section}-{value}"` is the test seam.
 */

const CATEGORY_VALUES = ['fiction', 'non-fiction', 'science', 'tech', 'history'] as const
const FORMAT_VALUES = ['pdf', 'epub'] as const
const LANGUAGE_VALUES = ['es', 'en'] as const

type Category = (typeof CATEGORY_VALUES)[number]
type Format = (typeof FORMAT_VALUES)[number]
type Language = (typeof LANGUAGE_VALUES)[number]

const SECTION_LABEL: Record<'category' | 'format' | 'language', string> = {
  category: 'Categoría',
  format: 'Formato',
  language: 'Idioma',
}

function getActiveSet<T extends string>(
  raw: string | null,
  allowed: readonly T[],
): Set<T> {
  if (raw === null) return new Set()
  const tokens = raw.split(',').map((token) => token.trim()).filter(Boolean)
  const allowedSet = new Set<string>(allowed)
  return new Set(tokens.filter((token): token is T => allowedSet.has(token)))
}

function toggleValue<T extends string>(
  current: Set<T>,
  value: T,
): Set<T> {
  const next = new Set(current)
  if (next.has(value)) {
    next.delete(value)
  } else {
    next.add(value)
  }
  return next
}

const SECTION_CLASSES =
  'text-xs uppercase tracking-wider text-[var(--color-text-muted)] font-semibold mb-2'

const CHIP_BASE_CLASSES =
  'px-2.5 py-1 text-xs rounded-full border transition border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-surface)] aria-pressed:bg-[var(--color-accent)] aria-pressed:text-white aria-pressed:border-[var(--color-accent)]'

function ChipRow<T extends string>({
  section,
  values,
  active,
  onToggle,
}: {
  section: 'category' | 'format' | 'language'
  values: readonly T[]
  active: Set<T>
  onToggle: (value: T) => void
}): React.JSX.Element {
  return (
    <div className="mb-5" data-testid={`filter-section-${section}`}>
      <p className={SECTION_CLASSES}>{SECTION_LABEL[section]}</p>
      <div className="flex flex-wrap gap-1.5">
        {values.map((value) => {
          const pressed = active.has(value)
          return (
            <button
              key={value}
              type="button"
              data-testid={`filter-${section}-${value}`}
              aria-pressed={pressed}
              onClick={() => onToggle(value)}
              className={CHIP_BASE_CLASSES}
            >
              {value}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function BrowseFilters(): React.JSX.Element {
  const router = useRouter()
  const searchParams = useSearchParams()

  const activeCategory = getActiveSet<Category>(
    searchParams.get('category'),
    CATEGORY_VALUES,
  )
  const activeFormat = getActiveSet<Format>(
    searchParams.get('format'),
    FORMAT_VALUES,
  )
  const activeLanguage = getActiveSet<Language>(
    searchParams.get('lang'),
    LANGUAGE_VALUES,
  )

  function writeParams(next: {
    category?: Set<Category>
    format?: Set<Format>
    language?: Set<Language>
    q?: string | null
  }): void {
    const params = new URLSearchParams(searchParams.toString())
    function apply<T extends string>(
      key: string,
      value: Set<T> | undefined,
    ): void {
      if (value === undefined) return
      if (value.size === 0) {
        params.delete(key)
      } else {
        params.set(key, [...value].join(','))
      }
    }
    apply('category', next.category)
    apply('format', next.format)
    apply('lang', next.language)
    if (next.q !== undefined) {
      if (next.q === null || next.q === '') {
        params.delete('q')
      } else {
        params.set('q', next.q)
      }
    }
    const qs = params.toString()
    router.replace(qs ? `?${qs}` : '?', { scroll: false })
  }

  function handleCategoryToggle(value: Category): void {
    writeParams({ category: toggleValue(activeCategory, value) })
  }

  function handleFormatToggle(value: Format): void {
    writeParams({ format: toggleValue(activeFormat, value) })
  }

  function handleLanguageToggle(value: Language): void {
    writeParams({ language: toggleValue(activeLanguage, value) })
  }

  return (
    <aside data-testid="browse-filters" aria-label="Filtros de catálogo" className="w-full">
      <ChipRow
        section="category"
        values={CATEGORY_VALUES}
        active={activeCategory}
        onToggle={handleCategoryToggle}
      />
      <ChipRow
        section="format"
        values={FORMAT_VALUES}
        active={activeFormat}
        onToggle={handleFormatToggle}
      />
      <ChipRow
        section="language"
        values={LANGUAGE_VALUES}
        active={activeLanguage}
        onToggle={handleLanguageToggle}
      />
    </aside>
  )
}