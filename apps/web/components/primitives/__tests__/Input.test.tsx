import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

/**
 * TDD — RED phase for `components/primitives/Input.tsx`
 * (PR-D1, REQ-MCL-001).
 *
 * `Input` is a thin wrapper around the native `<input>` element
 * with design-token styling (border / surface / focus ring) plus an
 * `error` prop that toggles the `aria-invalid` semantic. The
 * Browse search field uses it; the Search page input reuses it.
 *
 * Contract under test:
 *
 *   - Renders a native `<input>` element.
 *   - Forwards `value`, `placeholder`, `type`, `data-testid`, and
 *     `aria-label` to the underlying input (REQ-MCL-001 seam).
 *   - `onChange` fires with the new value when the user types.
 *   - When `error={true}` the input has `aria-invalid="true"` so
 *     assistive tech announces it as invalid.
 */

import { Input } from '../Input'

describe('Input (PR-D1, REQ-MCL-001)', () => {
  it('renders a native <input> element', () => {
    render(<Input data-testid="my-input" />)

    const input = screen.getByTestId('my-input')
    expect(input.tagName).toBe('INPUT')
  })

  it('forwards value, placeholder, and type to the native input', () => {
    render(
      <Input
        data-testid="my-input"
        value="hello"
        placeholder="Buscar…"
        type="search"
        onChange={() => undefined}
      />,
    )

    const input = screen.getByTestId('my-input') as HTMLInputElement
    expect(input.value).toBe('hello')
    expect(input.placeholder).toBe('Buscar…')
    expect(input.type).toBe('search')
  })

  it('forwards aria-label to the native input', () => {
    render(<Input data-testid="my-input" aria-label="Buscar libros" />)

    expect(screen.getByTestId('my-input')).toHaveAttribute(
      'aria-label',
      'Buscar libros',
    )
  })

  it('fires onChange with the new value when the user types', () => {
    const onChange = vi.fn()
    render(<Input data-testid="my-input" onChange={onChange} />)

    fireEvent.change(screen.getByTestId('my-input'), {
      target: { value: 'borges' },
    })

    expect(onChange).toHaveBeenCalledTimes(1)
    const eventArg = onChange.mock.calls[0]?.[0] as
      | { target: { value: string } }
      | undefined
    expect(eventArg?.target.value).toBe('borges')
  })

  it('applies aria-invalid="true" when the error prop is set', () => {
    render(<Input data-testid="my-input" error />)

    expect(screen.getByTestId('my-input')).toHaveAttribute('aria-invalid', 'true')
  })

  it('omits aria-invalid attribute when the error prop is NOT set', () => {
    render(<Input data-testid="my-input" />)

    const input = screen.getByTestId('my-input')
    expect(input.getAttribute('aria-invalid')).toBeNull()
  })
})