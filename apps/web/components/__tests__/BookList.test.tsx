import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { BookList } from '../BookList'
import { fixtureBooks } from './bookFixture'

describe('BookList', () => {
  it('renders one <li> per book with the title visible', () => {
    render(<BookList books={fixtureBooks} />)

    // Every title in the fixture must be in the document as visible text.
    for (const book of fixtureBooks) {
      expect(
        screen.getByRole('listitem', { name: new RegExp(book.title) }),
      ).toBeInTheDocument()
    }

    // Exactly one list element with the three fixture rows.
    expect(screen.getAllByRole('listitem')).toHaveLength(fixtureBooks.length)
  })
})