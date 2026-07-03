'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import { ProgressBar } from '@/components/primitives/ProgressBar'
import { ReaderToolbar } from '@/components/ReaderToolbar'
import type { Book } from '@/lib/hooks/useSampleLibrary'
import type {
  ReaderFontFamily,
  ReaderThemeId,
  ReaderTypography,
} from '@/components/ReaderToolbar'

/**
 * `ReaderView` — three-zone vertical layout for the reader route
 * (PR-C2, REQ-MRP-001 / MRP-003 / MRP-004 / MRP-005 / MRP-006).
 *
 *   - Zone 1: `<ReaderToolbar>` (52 px tall).
 *   - Zone 2: `<main>` content surface — at least three headings
 *             (`<h1>`, `<h2>`, `<h3>`) and five paragraphs of
 *             Lorem Ipsum, so the typography + theme controls
 *             have real DOM to act on.
 *   - Zone 3: `<ProgressBar>` (44 px tall).
 *
 * State held locally:
 *
 *   - `theme`            — applies `data-theme="reader-light|sepia|dark"`
 *                          to the content root.
 *   - `typography`       — applies fontSize / lineHeight / fontFamily
 *                          via inline style on the content root.
 *   - `progress`         — mock 0–100, derived from a stable hash of
 *                          the `bookId`, persisted per-book to
 *                          `localStorage['alejandria.reader.progress.<bookId>']`.
 *
 * Persisted cross-book to `localStorage.alejandria.reader.typography`
 * (REQ-MRP-003) and the reader theme per session.
 */

const TYPOGRAPHY_STORAGE_KEY = 'alejandria.reader.typography'

const DEFAULT_TYPOGRAPHY: ReaderTypography = {
  fontSize: 18,
  lineHeight: 1.6,
  fontFamily: 'serif',
}

const LOREM_PARAGRAPHS: readonly string[] = [
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed non risus. Suspendisse lectus tortor, dignissim sit amet, adipiscing nec, ultricies sed, dolor. Cras elementum ultrices diam. Maecenas ligula massa, varius a, semper congue, euismod non, mi. Proin porttitor, orci nec nonummy molestie, enim est eleifend mi, non fermentum diam nisl sit amet erat.',
  'Duis semper. Duis arcu massa, scelerisque vitae, consequat in, pretium a, enim. Pellentesque congue. Ut in risus volutpat libero convallis tempor. Curabitur vestibulum aliquam leo. Praesent fermentum tempor tellus. Nullam tempus. Sed tempus ligula eu lacinia.',
  'Quisque facilisis erat vitae dui. Nullam justo ipsum, hendrerit quis, volutpat non, facilisis eget, arcu. Aenean hendrerit metus eget purus vehicula, eu convallis lectus tempor. Phasellus eget sapien in nisl luctus vehicula. Vivamus commodo tristique tortor. Sed pellentesque massa eu turpis.',
  'Fusce sagittis, libero non molestie bibendum, felis lectus mollis orci, vitae interdum purus augue at ipsum. Maecenas vehicula, mauris in faucibus dictum, dui felis pharetra lorem, eu vulputate purus est sed velit. Suspendisse potenti. Donec auctor, elit ut convallis tincidunt, felis ipsum ornare sapien, ac aliquet nibh massa non velit.',
  'Nullam eget felis eget nisl luctus mollis. Praesent rutrum condimentum risus, ut tincidunt libero. Aenean imperdiet lorem eu magna bibendum, at suscipit orci egestas. Sed tincidunt tincidunt ligula, eu facilisis magna volutpat nec.',
]

const READER_THEMES: readonly { id: ReaderThemeId; bg: string; text: string }[] = [
  {
    id: 'reader-light',
    bg: '#fbf8f1',
    text: '#1d1d1f',
  },
  {
    id: 'reader-sepia',
    bg: '#f4ecd8',
    text: '#5b4636',
  },
  {
    id: 'reader-dark',
    bg: '#1c1c1e',
    text: '#f5f5f7',
  },
]

const FONT_STACKS: Record<ReaderFontFamily, string> = {
  serif: 'Georgia, "Times New Roman", serif',
  sans: '-apple-system, BlinkMacSystemFont, system-ui, sans-serif',
}

/** Stable hash for `bookId` → integer in `[0, 2^32)`. */
function hashBookId(bookId: string): number {
  let h = 2166136261
  for (let i = 0; i < bookId.length; i++) {
    h ^= bookId.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

/** Map the hash to a percentage in [0, 100). */
function progressFromBookId(bookId: string): number {
  return hashBookId(bookId) % 100
}

function readPersistedTypography(): ReaderTypography {
  if (typeof window === 'undefined') return DEFAULT_TYPOGRAPHY
  try {
    const raw = window.localStorage.getItem(TYPOGRAPHY_STORAGE_KEY)
    if (!raw) return DEFAULT_TYPOGRAPHY
    const parsed = JSON.parse(raw) as Partial<ReaderTypography>
    const fontSize = Number(parsed.fontSize ?? DEFAULT_TYPOGRAPHY.fontSize)
    const lineHeight = Number(parsed.lineHeight ?? DEFAULT_TYPOGRAPHY.lineHeight)
    const fontFamily: ReaderFontFamily =
      parsed.fontFamily === 'sans' ? 'sans' : 'serif'
    return {
      fontSize: Number.isFinite(fontSize) ? fontSize : DEFAULT_TYPOGRAPHY.fontSize,
      lineHeight: Number.isFinite(lineHeight)
        ? lineHeight
        : DEFAULT_TYPOGRAPHY.lineHeight,
      fontFamily,
    }
  } catch {
    return DEFAULT_TYPOGRAPHY
  }
}

function persistTypography(settings: ReaderTypography): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(TYPOGRAPHY_STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // localStorage may throw in private-mode — ignore, the in-memory
    // state still drives the surface and the settings live in React state.
  }
}

function readProgress(bookId: string): number {
  if (typeof window === 'undefined') return progressFromBookId(bookId)
  try {
    const raw = window.localStorage.getItem(progressKey(bookId))
    if (!raw) return progressFromBookId(bookId)
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return progressFromBookId(bookId)
    if (parsed < 0) return 0
    if (parsed > 100) return 100
    return parsed
  } catch {
    return progressFromBookId(bookId)
  }
}

function progressKey(bookId: string): string {
  return `alejandria.reader.progress.${bookId}`
}

function persistProgress(bookId: string, value: number): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(progressKey(bookId), String(value))
  } catch {
    // localStorage may throw in private-mode — ignore.
  }
}

export interface ReaderViewProps {
  book: Book
}

export function ReaderView({ book }: ReaderViewProps): React.JSX.Element {
  const [theme, setTheme] = useState<ReaderThemeId>('reader-light')
  const [typography, setTypography] = useState<ReaderTypography>(DEFAULT_TYPOGRAPHY)
  const [progress, setProgress] = useState<number>(progressFromBookId(book.id))

  // Hydrate persisted state once the component mounts. Doing it
  // here keeps SSR deterministic (the book id is stable, the
  // mock progress is purely from the book id; typography is
  // user-choice so we only read it client-side).
  useEffect(() => {
    setTypography(readPersistedTypography())
    setProgress(readProgress(book.id))
    // intentionally only on mount — book.id is the route key
    // (Single Responsibility for the persistence layer here).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleTypographyChange = useCallback((next: ReaderTypography) => {
    setTypography(next)
    persistTypography(next)
  }, [])

  const handleThemeChange = useCallback((next: ReaderThemeId) => {
    setTheme(next)
  }, [])

  const handleSeek = useCallback(
    (fraction: number) => {
      const next = Math.max(0, Math.min(100, Math.round(fraction * 100)))
      setProgress(next)
      persistProgress(book.id, next)
    },
    [book.id],
  )

  const handleNext = useCallback(() => {
    setProgress((current) => {
      const next = Math.min(100, current + 10)
      persistProgress(book.id, next)
      return next
    })
  }, [book.id])

  const handlePrev = useCallback(() => {
    setProgress((current) => {
      const next = Math.max(0, current - 10)
      persistProgress(book.id, next)
      return next
    })
  }, [book.id])

  const themeVars = useMemo(() => {
    const palette = READER_THEMES.find((entry) => entry.id === theme) ?? READER_THEMES[0]!
    return { bg: palette.bg, text: palette.text }
  }, [theme])

  const fontFamily = FONT_STACKS[typography.fontFamily]

  return (
    <div className="flex h-full flex-col">
      <ReaderToolbar
        onBack={() => undefined}
        onPrev={handlePrev}
        onNext={handleNext}
        onSearch={() => undefined}
        onTypographyChange={handleTypographyChange}
        typography={typography}
        onThemeChange={handleThemeChange}
        currentTheme={theme}
      />

      <div
        className="flex-1 overflow-auto"
        data-testid="reader-content"
        data-theme={theme}
      >
        <article
          className="mx-auto max-w-2xl px-6 py-10"
          style={{
            backgroundColor: themeVars.bg,
            color: themeVars.text,
            fontSize: `${typography.fontSize}px`,
            lineHeight: typography.lineHeight,
            fontFamily,
            minHeight: '100%',
          }}
        >
          <p
            className="mb-2 text-xs uppercase tracking-wide opacity-70"
            data-testid="reader-format"
          >
            {book.format.toUpperCase()} · {book.year}
          </p>
          <h1
            className="mb-6 font-semibold"
            data-testid="reader-h1"
            style={{ fontSize: '1.8em', lineHeight: 1.2 }}
          >
            {book.title}
          </h1>
          <h2
            className="mt-6 mb-3 font-medium opacity-90"
            data-testid="reader-h2"
            style={{ fontSize: '1.3em' }}
          >
            Chapter 1 — Beginning
          </h2>
          {LOREM_PARAGRAPHS.slice(0, 3).map((text, idx) => (
            <p key={`a-${idx}`} className="mb-4">
              {text}
            </p>
          ))}
          <h3
            className="mt-6 mb-3 font-medium opacity-90"
            data-testid="reader-h3"
            style={{ fontSize: '1.1em' }}
          >
            Chapter 2 — Middle
          </h3>
          {LOREM_PARAGRAPHS.slice(2, 5).map((text, idx) => (
            <p key={`b-${idx}`} className="mb-4">
              {text}
            </p>
          ))}
          {LOREM_PARAGRAPHS.slice(3, 5).map((text, idx) => (
            <p key={`c-${idx}`} className="mb-4">
              {LOREM_PARAGRAPHS[idx % LOREM_PARAGRAPHS.length]}
            </p>
          ))}
        </article>
      </div>

      <div
        className="h-[44px] border-t border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-2"
        data-testid="reader-progress-zone"
      >
        <ProgressBar
          value={progress}
          max={100}
          onSeek={handleSeek}
          data-testid="reader-progress"
        />
      </div>
    </div>
  )
}
