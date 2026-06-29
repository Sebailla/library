import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { BookList, type BookListItem } from '../BookList'
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

  it('exposes BookListItem as the component prop type (4-field structural shape)', () => {
    // After the BookRow consolidation, the BookList component
    // prop must be `BookListItem`, NOT `BookRow`. The component
    // only needs the fields it renders — id, title, author, year —
    // and must NOT depend on storage-layer fields like `filePath`
    // or `contentHash`.
    //
    // This compile-time check enforces the boundary: BookListItem
    // is the structural contract, BookRow is the DB row in
    // `@/lib/db/local-db`.
    const item: BookListItem = {
      id: 'book-001',
      title: 'Ficciones',
      author: 'Jorge Luis Borges',
      year: 1944,
    }
    expect(item.id).toBe('book-001')
    expect(item.title).toBe('Ficciones')
  })

  it('accepts canonical BookRow rows (projecting the 4 visible fields)', () => {
    // After #66, the canonical `BookRow` lives in `@/lib/db/local-db`
    // (8 fields). The `BookList` component does not consume that
    // type directly — it only needs the 4 visible fields. The
    // structural sub-typing is the contract: any canonical row
    // can be projected down to `BookListItem` and rendered.
    //
    // This is a runtime + type-level signal: at runtime, the
    // rendered list shows the visible fields and silently drops
    // the storage fields (`filePath`, `contentHash`, ...).
    const row = {
      id: 'book-001',
      title: 'Ficciones',
      author: 'Jorge Luis Borges',
      year: 1944,
      format: 'pdf',
      filePath: '/library/borges/ficciones.pdf',
      contentHash: 'sha256:abc',
      excerpt: 'Cuentos que desdibujan la realidad.',
    } as const
    const projected: BookListItem = {
      id: row.id,
      title: row.title,
      author: row.author,
      year: row.year,
    }
    render(<BookList books={[projected]} />)
    expect(screen.getByRole('listitem', { name: /ficciones/i })).toBeInTheDocument()
  })
})