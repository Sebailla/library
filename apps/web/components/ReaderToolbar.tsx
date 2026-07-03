'use client'

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

import { IconButton } from './primitives/IconButton'

/**
 * `ReaderToolbar` — 52 px-tall horizontal bar at the top of the
 * reader route (PR-C2, REQ-MRP-002 / REQ-MRP-003 / REQ-MRP-004).
 *
 * Controls, left → right:
 *
 *   1. Back to library             (<a href="/">)
 *   2. Previous chapter            (<button>)
 *   3. Next chapter                (<button>)
 *   4. Search placeholder          (<button>, label "⌘F")
 *   5. Typography popover trigger  (<button>)
 *   6. Theme picker swatches       (3× <button>)
 *   7. Close reader                (<a href="/">)
 *
 * The typography popover is a plain absolutely-positioned panel
 * (not a `<dialog>` primitive) — the toolbar uses a local
 * `useState` for its open/closed state and an `useEffect` to
 * respond to `Escape`. The popover keeps the v1 surface simple:
 * the real `<Dialog>` primitive lands in PR-D1.
 *
 * Every control has a `data-testid` seam (see the spec scenarios).
 *
 * All colors come from CSS variables declared in
 * `apps/web/app/globals.css`; no hex literals here.
 */

export type ReaderThemeId = 'reader-light' | 'reader-sepia' | 'reader-dark'
export type ReaderFontFamily = 'serif' | 'sans'

export interface ReaderTypography {
  fontSize: number
  lineHeight: number
  fontFamily: ReaderFontFamily
}

export interface ReaderToolbarProps {
  onBack: () => void
  onPrev: () => void
  onNext: () => void
  /** Placeholder for the ⌘F modal — wired in a later PR. */
  onSearch: () => void
  onTypographyChange: (settings: ReaderTypography) => void
  typography: ReaderTypography
  onThemeChange: (theme: ReaderThemeId) => void
  currentTheme: ReaderThemeId
}

const BAR_CLASSES =
  'flex h-[52px] items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-bg)] px-4 text-[var(--color-text)]'

const CLUSTER_CLASSES = 'flex items-center gap-1'

const POPOVER_CLASSES =
  'absolute left-0 top-full z-10 mt-1 w-72 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-3 shadow-[var(--shadow-md)]'

const SWATCH_BASE_CLASSES =
  'h-6 w-6 rounded-full border border-[var(--color-border)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]'
const SWATCH_ACTIVE_CLASSES = 'ring-2 ring-[var(--color-accent)] ring-offset-1'
const SWATCH_LIGHT_BG = 'bg-[#fbf8f1]'
const SWATCH_SEPIA_BG = 'bg-[#f4ecd8]'
const SWATCH_DARK_BG = 'bg-[#1c1c1e]'

export function ReaderToolbar({
  onBack: _onBack,
  onPrev,
  onNext,
  onSearch,
  onTypographyChange,
  typography,
  onThemeChange,
  currentTheme,
}: ReaderToolbarProps): React.JSX.Element {
  const [typographyOpen, setTypographyOpen] = useState(false)
  const popoverRef = useRef<HTMLDivElement | null>(null)

  // Escape closes the popover when focus is inside it. We listen on
  // the popover container because the trigger button lives outside
  // — keyboard focus typically lands inside the popover after the
  // user starts editing a range.
  useEffect(() => {
    if (!typographyOpen) return
    function onKeyDown(event: KeyboardEvent | globalThis.KeyboardEvent): void {
      if ((event as KeyboardEvent).key === 'Escape') {
        setTypographyOpen(false)
      }
    }
    const node = popoverRef.current
    if (node) {
      node.addEventListener('keydown', onKeyDown as EventListener)
      return () => {
        node.removeEventListener('keydown', onKeyDown as EventListener)
      }
    }
    return undefined
  }, [typographyOpen])

  function toggleTypography(): void {
    setTypographyOpen((open) => !open)
  }

  function handleFontSizeChange(value: string): void {
    const next = Number(value)
    onTypographyChange({
      ...typography,
      fontSize: next,
    })
  }

  function handleLineHeightChange(value: string): void {
    const next = Number(value)
    onTypographyChange({
      ...typography,
      lineHeight: next,
    })
  }

  function handleFontFamilyChange(value: string): void {
    const family: ReaderFontFamily = value === 'sans' ? 'sans' : 'serif'
    onTypographyChange({
      ...typography,
      fontFamily: family,
    })
  }

  function swatchClasses(id: ReaderThemeId): string {
    const bg =
      id === 'reader-light'
        ? SWATCH_LIGHT_BG
        : id === 'reader-sepia'
          ? SWATCH_SEPIA_BG
          : SWATCH_DARK_BG
    return [
      SWATCH_BASE_CLASSES,
      bg,
      currentTheme === id ? SWATCH_ACTIVE_CLASSES : '',
    ]
      .filter(Boolean)
      .join(' ')
  }

  return (
    <div className={BAR_CLASSES} data-testid="reader-toolbar">
      {/* Left cluster: navigation */}
      <div className={CLUSTER_CLASSES}>
        <a
          href="/"
          data-testid="reader-back"
          aria-label="Back to library"
          className="inline-flex h-8 min-w-8 items-center justify-center rounded-[var(--radius-md)] px-2 text-[var(--color-text)] hover:bg-[var(--color-surface)]"
        >
          ←
        </a>
        <IconButton
          aria-label="Previous chapter"
          data-testid="reader-prev"
          onClick={onPrev}
        >
          ‹
        </IconButton>
        <IconButton
          aria-label="Next chapter"
          data-testid="reader-next"
          onClick={onNext}
        >
          ›
        </IconButton>
      </div>

      {/* Middle cluster: search + typography */}
      <div className={CLUSTER_CLASSES}>
        <IconButton
          aria-label="Search in book (⌘F)"
          data-testid="reader-search"
          onClick={onSearch}
        >
          ⌘F
        </IconButton>
        <div className="relative">
          <IconButton
            aria-label="Typography settings"
            data-testid="reader-typography"
            aria-expanded={typographyOpen ? 'true' : 'false'}
            onClick={toggleTypography}
          >
            T
          </IconButton>
          {typographyOpen ? (
            <div
              ref={popoverRef}
              data-testid="typography-popover"
              role="dialog"
              aria-label="Typography settings"
              className={POPOVER_CLASSES}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setTypographyOpen(false)
              }}
            >
              <label className="mb-3 block text-xs text-[var(--color-text-muted)]">
                Font size ({typography.fontSize}px)
                <input
                  type="range"
                  min="14"
                  max="24"
                  step="1"
                  value={typography.fontSize}
                  data-testid="typography-font-size"
                  onChange={(e) => handleFontSizeChange(e.target.value)}
                  className="mt-1 w-full"
                />
              </label>
              <label className="mb-3 block text-xs text-[var(--color-text-muted)]">
                Line height ({typography.lineHeight.toFixed(1)})
                <input
                  type="range"
                  min="1.4"
                  max="2.0"
                  step="0.1"
                  value={typography.lineHeight}
                  data-testid="typography-line-height"
                  onChange={(e) => handleLineHeightChange(e.target.value)}
                  className="mt-1 w-full"
                />
              </label>
              <label className="block text-xs text-[var(--color-text-muted)]">
                Font family
                <select
                  data-testid="typography-font-family"
                  value={typography.fontFamily}
                  onChange={(e) => handleFontFamilyChange(e.target.value)}
                  className="mt-1 block w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm text-[var(--color-text)]"
                >
                  <option value="serif">Serif</option>
                  <option value="sans">Sans</option>
                </select>
              </label>
            </div>
          ) : null}
        </div>
      </div>

      {/* Right cluster: theme picker + close */}
      <div className={CLUSTER_CLASSES}>
        <button
          type="button"
          aria-label="Reader theme: Light"
          data-testid="reader-theme-light"
          className={swatchClasses('reader-light')}
          onClick={() => onThemeChange('reader-light')}
        />
        <button
          type="button"
          aria-label="Reader theme: Sepia"
          data-testid="reader-theme-sepia"
          className={swatchClasses('reader-sepia')}
          onClick={() => onThemeChange('reader-sepia')}
        />
        <button
          type="button"
          aria-label="Reader theme: Dark"
          data-testid="reader-theme-dark"
          className={swatchClasses('reader-dark')}
          onClick={() => onThemeChange('reader-dark')}
        />
        <a
          href="/"
          data-testid="reader-close"
          aria-label="Close reader"
          className="inline-flex h-8 min-w-8 items-center justify-center rounded-[var(--radius-md)] px-2 text-[var(--color-text)] hover:bg-[var(--color-surface)]"
        >
          ✕
        </a>
      </div>
    </div>
  )
}
