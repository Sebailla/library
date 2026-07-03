'use client'

import type { CSSProperties, MouseEvent } from 'react'

/**
 * `ProgressBar` — native `<progress>` primitive (PR-C1, REQ-MCL-008).
 *
 * Two responsibilities:
 *
 *   1. Render a native `<progress value={value} max={max}>` so
 *      browsers / a11y tools (VoiceOver, NVDA) all recognise the
 *      semantic role without extra ARIA. Value is clamped to
 *      `[0, max]` so an out-of-range input never produces a
 *      negative width or a >100% fill.
 *
 *   2. Wrap the bar in a clickable track that converts the click
 *      X coordinate to a `[0, 1]` fraction and forwards it via
 *      `onSeek(fraction)`. Hosts (BookCard, Reader) use this to
 *      persist a new position. The native `<progress>` itself is
 *      not clickable across all engines, so we wrap rather than
 *      put the handler on the progress element.
 *
 * Visual styling: track uses `--color-border`, fill uses
 * `--color-accent`. Both come from `globals.css` so dark theme
 * flips the colors for free — no hex literals here.
 */

const DEFAULT_MAX = 100

function clamp(value: number, max: number): number {
  if (Number.isNaN(value)) return 0
  if (value < 0) return 0
  if (value > max) return max
  return value
}

export interface ProgressBarProps {
  /** Current progress value. Clamped to `[0, max]`. */
  value: number
  /** Maximum value (right edge of the bar). Defaults to 100. */
  max?: number
  /**
   * Invoked when the user clicks the track. Receives the click
   * X coordinate converted to a `[0, 1]` fraction of the track
   * width. Undefined means the bar is read-only.
   */
  onSeek?: (fraction: number) => void
  /** Forwarded to the outermost track wrapper for RTL queries. */
  'data-testid'?: string
}

const TRACK_CLASSES =
  'h-1 w-full rounded-[var(--radius-sm)] bg-[var(--color-border)] overflow-hidden cursor-pointer'

const FILL_STYLE: CSSProperties = {
  backgroundColor: 'var(--color-accent)',
  height: '100%',
  transition: 'width 120ms linear',
}

export function ProgressBar({
  value,
  max = DEFAULT_MAX,
  onSeek,
  'data-testid': testId,
}: ProgressBarProps): React.JSX.Element {
  const safeMax = max > 0 ? max : DEFAULT_MAX
  const clampedValue = clamp(value, safeMax)
  const fraction = clampedValue / safeMax

  function handleClick(event: MouseEvent<HTMLDivElement>): void {
    if (!onSeek) return
    const rect = event.currentTarget.getBoundingClientRect()
    const width = rect.width || rect.right - rect.left
    if (width <= 0) return
    const ratio = (event.clientX - rect.left) / width
    const clipped = Math.max(0, Math.min(1, ratio))
    onSeek(clipped)
  }

  return (
    <div
      data-testid={testId ? `${testId}-track` : undefined}
      className={TRACK_CLASSES}
      onClick={handleClick}
      role="presentation"
    >
      <progress
        value={clampedValue}
        max={safeMax}
        data-testid={testId}
        className="sr-only"
      />
      <div
        data-testid={testId ? `${testId}-fill` : undefined}
        style={{ ...FILL_STYLE, width: `${fraction * 100}%` }}
      />
    </div>
  )
}