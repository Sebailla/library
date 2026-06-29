import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { ProgressBar } from '../ProgressBar'

describe('ProgressBar', () => {
  it('renders the current page and total page count', () => {
    render(<ProgressBar currentPage={3} totalPages={10} />)

    // The progress label is a real, behavior-visible number pair —
    // not a CSS class assertion or an internal state check.
    expect(screen.getByText(/page 3 of 10/i)).toBeInTheDocument()
  })

  it('renders the percentage derived from currentPage/totalPages', () => {
    render(<ProgressBar currentPage={1} totalPages={4} />)

    // 1/4 = 25%
    expect(screen.getByText(/25%/)).toBeInTheDocument()
  })

  it('clamps the displayed percentage between 0 and 100', () => {
    const { rerender } = render(<ProgressBar currentPage={0} totalPages={10} />)
    expect(screen.getByText(/0%/)).toBeInTheDocument()

    rerender(<ProgressBar currentPage={99} totalPages={10} />)
    expect(screen.getByText(/100%/)).toBeInTheDocument()
  })

  it('sets the progressbar role with the right aria attributes', () => {
    render(<ProgressBar currentPage={3} totalPages={10} />)

    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '30')
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '100')
  })
})
