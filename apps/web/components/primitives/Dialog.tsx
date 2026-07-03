'use client'

import { useEffect, useRef, type ReactNode } from 'react'

/**
 * `Dialog` — controlled wrapper around the native `<dialog>`
 * element (PR-D1, REQ-MCL-006).
 *
 *   - Native `<dialog>` so the browser handles the modal backdrop,
 *     focus trapping, and Escape-to-close for free.
 *   - `open={true}` calls `showModal()` on mount / transition.
 *   - `open={false}` calls `close()` so the controlled state stays
 *     in sync (e.g. when the parent flips state from a button).
 *   - Both the `cancel` (Escape) and `close` events invoke
 *     `onClose` so the parent can react and update its state.
 *   - Forwards `data-testid="dialog"` (outer) and
 *     `data-testid="dialog-content"` (inner content seam) per
 *     REQ-MCL-001.
 *
 * Known limitation (deliberate for v1):
 *
 *   - No explicit focus-trap. The native `<dialog showModal()>` API
 *     provides focus trapping for the modal's tabbable descendants
 *     in all modern browsers; jsdom does NOT fully implement
 *     showModal so this code path is exercised by E2E or manual
 *     smoke tests, not by jsdom unit tests. The component is
 *     written so that real-browser behaviour matches the spec
 *     (REQ-MCL-006: focus is trapped within the dialog while
 *     open).
 */

export interface DialogProps {
  /** Controlled open state. */
  open: boolean
  /** Fired on Escape (cancel) and on close events. */
  onClose: () => void
  /** Optional title rendered as an `<h2>` above the content. */
  title?: string
  /** Body content. */
  children: ReactNode
  /** Forwarded as `data-testid` on the outer `<dialog>`. */
  'data-testid'?: string
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  'data-testid': dataTestid,
}: DialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (open) {
      // `showModal` is not implemented in jsdom — guard so the
      // unit tests run without throwing. Real browsers throw only
      // if the dialog is already open or detached.
      if (typeof dialog.showModal === 'function') {
        try {
          dialog.showModal()
        } catch {
          // Dialog already open or detached — safe to ignore.
        }
      }
    } else {
      if (typeof dialog.close === 'function') {
        try {
          dialog.close()
        } catch {
          // Dialog already closed — safe to ignore.
        }
      }
    }
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      data-testid={dataTestid ?? 'dialog'}
      onCancel={onClose}
      onClose={onClose}
      className="rounded-[var(--radius-lg)] p-6 bg-[var(--color-bg)] text-[var(--color-text)] backdrop:bg-black/40"
    >
      <div data-testid="dialog-content">
        {title !== undefined && title !== '' ? (
          <h2 className="text-lg font-semibold mb-3">{title}</h2>
        ) : null}
        {children}
      </div>
    </dialog>
  )
}