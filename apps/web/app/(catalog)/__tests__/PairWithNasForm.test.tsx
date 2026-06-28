import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

/**
 * TDD tests for `app/(catalog)/PairWithNasForm.tsx` (PR-3C).
 *
 * The "Pair with NAS" CTA is a Client Component that submits
 * a Server Action. The form surface under test:
 *
 *  - PIN input (type=password, required, min 4 chars)
 *  - device name input (type=text, default to the user agent prefix)
 *  - submit button
 *
 * The Server Action is mocked so the form is rendered without
 * touching the network. The actual action behaviour is covered
 * by `app/_actions/__tests__/nas-actions.test.ts`.
 */

const { pairDeviceMock } = vi.hoisted(() => ({
  pairDeviceMock: vi.fn(),
}))

vi.mock('@/app/_actions/nas-actions', () => ({
  pairDevice: pairDeviceMock,
}))

import { PairWithNasForm } from '../PairWithNasForm'

describe('PairWithNasForm (PR-3C)', () => {
  it('renders the PIN and device-name fields plus a submit button', () => {
    render(<PairWithNasForm />)

    expect(screen.getByTestId('pair-with-nas-form')).toBeInTheDocument()
    expect(screen.getByLabelText(/PIN/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/device name/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /pair/i })).toBeInTheDocument()
  })
})
