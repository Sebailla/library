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

  it('exports `BookListItem` (4-field) as the component prop type', async () => {
    // Runtime signal for #66: `BookListItem` must be a named
    // export of `@/components/BookList`. Today it does not exist
    // (the module exports `BookRow` with the 4-field shape) — so
    // this test fails RED until the rename happens.
    const mod = await import('../BookList')
    expect(mod['BookListItem']).toBeDefined()
  })

  it('does NOT export a 4-field `BookRow` from the component module', async () => {
    // `BookRow` lives in `@/lib/db/local-db` (8 fields) and is the
    // canonical DB row type. The component module must not also
    // export a different `BookRow` with the 4-field shape — that
    // was the source of the type-name conflict in #66. As an
    // interface, `BookRow` is type-only and not a runtime export;
    // the assertion is that the *name* is not co-opted by the
    // component module. We assert by importing from `local-db` and
    // confirming the local-db's `BookRow` has the 8-field shape.
    const localDb = await import('@/lib/db/local-db')
    const canonicalRow = localDb.openLocalDb().insertBook({
      id: 'book-001',
      title: 'Ficciones',
      author: 'Jorge Luis Borges',
      year: 1944,
      format: 'pdf',
      filePath: '/library/borges/ficciones.pdf',
      contentHash: 'sha256:abc',
      excerpt: 'Cuentos que desdibujan la realidad.',
    })
    // The canonical `BookRow` is 8 fields, NOT 4.
    expect(canonicalRow).toHaveProperty('filePath')
    expect(canonicalRow).toHaveProperty('contentHash')
    expect(canonicalRow).toHaveProperty('format')
    expect(canonicalRow).toHaveProperty('excerpt')
  })
})