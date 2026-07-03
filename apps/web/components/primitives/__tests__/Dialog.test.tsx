import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

/**
 * TDD — RED phase for `components/primitives/Dialog.tsx`
 * (PR-D1, REQ-MCL-006).
 *
 * `Dialog` wraps the native `<dialog>` element with a controlled
 * open/close contract that the Browse and Reader surfaces compose.
 * The contract under test:
 *
 *   - Renders a native `<dialog>` element (so screen readers + ESC
 *     work for free).
 *   - Forwards `data-testid="dialog"` (REQ-MCL-001 seam) and the
 *     `data-testid="dialog-content"` inner seam.
 *   - `open={true}` calls `HTMLDialogElement.prototype.showModal()`.
 *   - `open={false}` calls `HTMLDialogElement.prototype.close()`.
 *   - Pressing Escape while the dialog is open closes it (the
 *     native `<dialog>` fires a `cancel` event then a `close`
 *     event — both must invoke `onClose`).
 *   - The native `<dialog>` `close` event invokes `onClose` so
 *     controlled callers can sync state.
 *
 * jsdom 25 implements `HTMLDialogElement` (as a class) but does
 * NOT implement `showModal` / `close` methods on the prototype.
 * We attach spy `vi.fn()` shims to the prototype so the component
 * can call them without throwing. The shims are reset between
 * tests via `vi.restoreAllMocks()`.
 */

import { Dialog } from '../Dialog'

function ensureDialogMethodShims(): void {
  const proto = HTMLDialogElement.prototype as unknown as {
    showModal?: () => void
    close?: () => void
  }
  if (typeof proto.showModal !== 'function') {
    Object.defineProperty(proto, 'showModal', {
      configurable: true,
      writable: true,
      value: function showModal(this: HTMLDialogElement): void {
        this.setAttribute('open', '')
      },
    })
  }
  if (typeof proto.close !== 'function') {
    Object.defineProperty(proto, 'close', {
      configurable: true,
      writable: true,
      value: function close(this: HTMLDialogElement): void {
        this.removeAttribute('open')
      },
    })
  }
}

describe('Dialog (PR-D1, REQ-MCL-006)', () => {
  beforeEach(() => {
    ensureDialogMethodShims()
    vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(
      function (this: HTMLDialogElement) {
        this.setAttribute('open', '')
      },
    )
    vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(
      function (this: HTMLDialogElement) {
        this.removeAttribute('open')
      },
    )
  })

  it('renders a native <dialog> with data-testid="dialog" and inner data-testid="dialog-content"', () => {
    render(
      <Dialog open onClose={() => undefined} title="My title">
        <p>Body</p>
      </Dialog>,
    )

    const dialog = screen.getByTestId('dialog')
    expect(dialog.tagName).toBe('DIALOG')
    expect(screen.getByTestId('dialog-content')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'My title' })).toBeInTheDocument()
  })

  it('calls showModal() when open={true}', () => {
    render(
      <Dialog open onClose={() => undefined}>
        <p>x</p>
      </Dialog>,
    )

    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledTimes(1)
  })

  it('calls close() when open transitions from true to false', () => {
    const { rerender } = render(
      <Dialog open onClose={() => undefined}>
        <p>x</p>
      </Dialog>,
    )

    rerender(
      <Dialog open={false} onClose={() => undefined}>
        <p>x</p>
      </Dialog>,
    )

    expect(HTMLDialogElement.prototype.close).toHaveBeenCalled()
  })

  it('does NOT call showModal() on initial render with open={false}', () => {
    render(
      <Dialog open={false} onClose={() => undefined}>
        <p>x</p>
      </Dialog>,
    )

    expect(HTMLDialogElement.prototype.showModal).not.toHaveBeenCalled()
  })

  it('invokes onClose when the native <dialog> fires the cancel event (Escape)', () => {
    const onClose = vi.fn()
    render(
      <Dialog open onClose={onClose}>
        <p>x</p>
      </Dialog>,
    )

    const dialog = screen.getByTestId('dialog')
    fireEvent(dialog, new Event('cancel', { bubbles: true }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('invokes onClose when the native <dialog> fires the close event', () => {
    const onClose = vi.fn()
    render(
      <Dialog open onClose={onClose}>
        <p>x</p>
      </Dialog>,
    )

    const dialog = screen.getByTestId('dialog')
    fireEvent(dialog, new Event('close', { bubbles: true }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})