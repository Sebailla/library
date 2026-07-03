'use client'

import { useState, type SyntheticEvent } from 'react'

import { ProgressBar } from './primitives/ProgressBar'
import type { Book } from '@/lib/hooks/useSampleLibrary'

/**
 * `BookCard` — cover-first book tile consumed by every page-level
 * grid: Library (PR-C1), Browse (PR-D1), Search (PR-D2).
 *
 * Surface (REQ-MCL-003):
 *
 *   - Outer `<a href="/reader/<id>">` so the card is a single
 *     navigation target (one tab stop per book).
 *   - Cover `<img>` with `loading="lazy"` and a stable
 *     `aspect-[2/3]` so grid rows lock before the image loads.
 *   - On `onError` the cover swaps its `src` to an inline SVG
 *     data URL with the book's initials on a background color
 *     hashed from the id (deterministic fallback, Open decision #3).
 *   - Title (2-line clamp) + author (1-line clamp) below the cover.
 *   - Year + format chip below the author, hidden in `compact` mode.
 *   - Optional progress bar overlay at the bottom of the cover,
 *     rendered by the `ProgressBar` primitive when `progress` is set.
 *
 * Variants:
 *
 *   - `default` — full grid cell with chip + progress.
 *   - `compact` — narrower (120 px), chip hidden. Used by
 *     `SearchResults` grouped lists (PR-D2).
 *
 * Token-driven: every color / shadow comes from `globals.css`
 * CSS variables — no hex literals.
 */

export interface BookCardProps {
  book: Book
  size?: 'default' | 'compact'
}

const CARD_BASE_CLASSES =
  'group block rounded-[var(--radius-lg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2'

const COMPACT_CLASSES = 'w-[120px]'
const DEFAULT_CLASSES = 'w-full'

/** djb2-ish hash → hue 0..360. Deterministic per id. */
function hashHue(id: string): number {
  let h = 5381
  for (let i = 0; i < id.length; i++) {
    h = (h * 33) ^ id.charCodeAt(i)
  }
  return Math.abs(h) % 360
}

/**
 * First letter of first word + first letter of last word. If
 * the title has only one word, use the first two characters.
 */
function deriveInitials(title: string): string {
  const trimmed = title.trim()
  if (!trimmed) return '?'
  const words = trimmed.split(/\s+/)
  if (words.length === 1) return trimmed.slice(0, 2).toUpperCase()
  const first = words[0]?.[0] ?? ''
  const last = words[words.length - 1]?.[0] ?? ''
  return `${first}${last}`.toUpperCase()
}

/**
 * Inline SVG data URL — preserves the cover's 2:3 aspect ratio so
 * the layout does not collapse when the original `src` fails. The
 * hue is derived from the id so the same book always renders the
 * same placeholder (no flicker on re-render).
 */
function buildPlaceholderDataUrl(title: string, id: string): string {
  const initials = deriveInitials(title)
  const hue = hashHue(id)
  const bg = `hsl(${hue}, 60%, 45%)`
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 150" preserveAspectRatio="xMidYMid slice">` +
    `<rect width="100" height="150" fill="${bg}"/>` +
    `<text x="50" y="82" text-anchor="middle" font-size="40" font-family="-apple-system, system-ui, sans-serif" font-weight="600" fill="white">${initials}</text>` +
    `</svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

const COVER_CLASSES =
  'aspect-[2/3] w-full object-cover rounded-[var(--radius-lg)] shadow-[var(--shadow-md)] group-hover:shadow-[var(--shadow-lg)] group-hover:-translate-y-0.5 transition'

const TITLE_CLASSES =
  'mt-2 text-sm font-medium text-[var(--color-text)] line-clamp-2'

const AUTHOR_CLASSES =
  'mt-0.5 text-xs text-[var(--color-text-muted)] line-clamp-1'

const META_CLASSES =
  'mt-0.5 text-xs text-[var(--color-text-muted)]'

const PROGRESS_WRAPPER_CLASSES =
  'pointer-events-none absolute inset-x-0 bottom-0 p-1'

export function BookCard({ book, size = 'default' }: BookCardProps): React.JSX.Element {
  const [imgSrc, setImgSrc] = useState<string>(book.coverUrl)
  const isCompact = size === 'compact'

  function handleCoverError(event: SyntheticEvent<HTMLImageElement>): void {
    const target = event.currentTarget
    // Avoid infinite loop if the placeholder itself errors.
    if (target.dataset['fallback'] === '1') return
    target.dataset['fallback'] = '1'
    setImgSrc(buildPlaceholderDataUrl(book.title, book.id))
  }

  const cardClasses = [
    CARD_BASE_CLASSES,
    isCompact ? COMPACT_CLASSES : DEFAULT_CLASSES,
  ].join(' ')

  return (
    <a
      href={`/reader/${book.id}`}
      data-testid="book-card"
      className={cardClasses}
    >
      <div className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          data-testid="book-cover"
          src={imgSrc}
          alt={book.title}
          loading="lazy"
          className={COVER_CLASSES}
          onError={handleCoverError}
        />
        {book.progress != null ? (
          <div className={PROGRESS_WRAPPER_CLASSES}>
            <ProgressBar value={book.progress * 100} max={100} />
          </div>
        ) : null}
      </div>
      <h3 className={TITLE_CLASSES}>{book.title}</h3>
      <p className={AUTHOR_CLASSES}>{book.author}</p>
      {!isCompact ? (
        <p className={META_CLASSES}>
          {book.year} · <span>{book.format.toUpperCase()}</span>
        </p>
      ) : null}
    </a>
  )
}