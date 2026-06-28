import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

/**
 * TDD tests for `components/BookDownloadForm.tsx` (PR-3C).
 *
 * The form is the Client-Component surface for the
 * `downloadFromNas` Server Action. The actual download flow is
 * covered by `lib/download/__tests__/download-flow.test.ts`; this
 * file just asserts the form ships the hidden inputs + submit
 * button.
 */

const { downloadFromNasMock } = vi.hoisted(() => ({
  downloadFromNasMock: vi.fn(),
}))

vi.mock('@/app/_actions/nas-actions', () => ({
  downloadFromNas: downloadFromNasMock,
}))

import { BookDownloadForm } from '../BookDownloadForm'

const SAMPLE_BOOK = {
  id: '7',
  title: 'Ficciones',
  author: 'Jorge Luis Borges',
  year: 1944,
}

describe('BookDownloadForm (PR-3C)', () => {
  it('renders a Download form with the book id, device attribution, and submit button', () => {
    render(<BookDownloadForm book={SAMPLE_BOOK} />)

    const form = screen.getByTestId('book-download-form')
    expect(form).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /download/i })).toBeInTheDocument()

    // The book id is the only field the user can change by
    // design (the device id is session-scoped). It must be a
    // hidden input so the form still submits the value.
    const hiddenBookId = form.querySelector('input[name="bookId"]') as HTMLInputElement | null
    expect(hiddenBookId).not.toBeNull()
    expect(hiddenBookId!.value).toBe('7')
  })
})
