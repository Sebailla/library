import { describe, expect, it } from 'vitest'

import { useSampleLibrary } from '../useSampleLibrary'

/**
 * TDD — RED phase for `lib/hooks/useSampleLibrary.ts` (PR-C1,
 * REQ-MLP-002 / REQ-MLP-003).
 *
 * The hook is the single source of truth for the 12-book sample
 * dataset. The contract under test:
 *
 *   - Returns an array of exactly 12 books.
 *   - Every book has the canonical 6 required fields populated:
 *     id, title, author, year, format, coverUrl.
 *   - `format` is exactly `'pdf'` or `'epub'`.
 *   - `coverUrl` matches the Open Library cover pattern.
 *   - Year spread covers [1950, 2024].
 *   - At least 4 PDFs and 4 EPUBs.
 *   - At least 4 Spanish-tagged authors and 4 English-tagged
 *     authors (the `lang` field is the language discriminator,
 *     added per Open decision #3 — see `sample-library.json`).
 */

describe('useSampleLibrary (PR-C1, REQ-MLP-002 / REQ-MLP-003)', () => {
  it('returns an array of exactly 12 books', () => {
    const books = useSampleLibrary()
    expect(books).toHaveLength(12)
  })

  it('every book has the required 6 fields populated', () => {
    const books = useSampleLibrary()
    for (const book of books) {
      expect(book.id).toBeTruthy()
      expect(book.title).toBeTruthy()
      expect(book.author).toBeTruthy()
      expect(typeof book.year).toBe('number')
      expect(book.format).toBeTruthy()
      expect(book.coverUrl).toBeTruthy()
    }
  })

  it('format is exactly one of pdf or epub', () => {
    const books = useSampleLibrary()
    for (const book of books) {
      expect(['pdf', 'epub']).toContain(book.format)
    }
  })

  it('every coverUrl matches the Open Library ISBN cover pattern', () => {
    const books = useSampleLibrary()
    const pattern = /^https:\/\/covers\.openlibrary\.org\/b\/isbn\/\d+-M\.jpg$/
    for (const book of books) {
      expect(book.coverUrl).toMatch(pattern)
    }
  })

  it('years cover the 1950–2024 range', () => {
    const books = useSampleLibrary()
    const years = books.map((b) => b.year)
    expect(Math.min(...years)).toBeGreaterThanOrEqual(1950)
    expect(Math.max(...years)).toBeLessThanOrEqual(2024)
  })

  it('contains at least 4 PDFs and 4 EPUBs', () => {
    const books = useSampleLibrary()
    const pdfCount = books.filter((b) => b.format === 'pdf').length
    const epubCount = books.filter((b) => b.format === 'epub').length
    expect(pdfCount).toBeGreaterThanOrEqual(4)
    expect(epubCount).toBeGreaterThanOrEqual(4)
  })

  it('contains at least 4 Spanish and 4 English authors', () => {
    const books = useSampleLibrary()
    const esCount = books.filter((b) => b.lang === 'es').length
    const enCount = books.filter((b) => b.lang === 'en').length
    expect(esCount).toBeGreaterThanOrEqual(4)
    expect(enCount).toBeGreaterThanOrEqual(4)
  })

  it('every book has a unique id', () => {
    const books = useSampleLibrary()
    const ids = books.map((b) => b.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})