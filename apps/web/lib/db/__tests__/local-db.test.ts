import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openLocalDb } from '../local-db'

/**
 * TDD tests for `lib/db/local-db.ts` (PR-3B).
 *
 * Behaviour under test (per `local-library-db` spec):
 *  - insertBook + findById round-trip preserves every field
 *  - listBooks returns rows ordered newest-first by rowid
 *  - searchBooks uses FTS5 and returns partial matches in title
 *
 * Each test opens a fresh DB in a tmpdir so they are independent
 * and run in parallel.
 */

describe('local-db (PR-3B)', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'alejandria-localdb-'))
    process.env['ALEJANDRIA_DATA_DIR'] = tmpDir
  })

  afterEach(() => {
    delete process.env['ALEJANDRIA_DATA_DIR']
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('insertBook + findById round-trip preserves every field', () => {
    const db = openLocalDb()

    const inserted = db.insertBook({
      id: 'book-001',
      title: 'Ficciones',
      author: 'Jorge Luis Borges',
      year: 1944,
      format: 'epub',
      filePath: '/library/borges/ficciones.epub',
      contentHash: 'sha256:abc123',
      excerpt: 'Cuentos que desdibujan la realidad.',
    })

    expect(inserted.id).toBe('book-001')

    const found = db.findById('book-001')
    expect(found).not.toBeNull()
    expect(found).toMatchObject({
      id: 'book-001',
      title: 'Ficciones',
      author: 'Jorge Luis Borges',
      year: 1944,
      format: 'epub',
      filePath: '/library/borges/ficciones.epub',
      contentHash: 'sha256:abc123',
      excerpt: 'Cuentos que desdibujan la realidad.',
    })

    db.close()
  })

  it('findById returns null for an unknown id', () => {
    const db = openLocalDb()
    expect(db.findById('does-not-exist')).toBeNull()
    db.close()
  })

  it('listBooks returns rows in newest-first order', () => {
    const db = openLocalDb()

    db.insertBook({
      id: 'book-a',
      title: 'El Aleph',
      author: 'Jorge Luis Borges',
      year: 1949,
      format: 'epub',
      filePath: '/library/borges/aleph.epub',
      contentHash: 'sha256:aaa',
      excerpt: 'Un punto que contiene todos los puntos.',
    })
    db.insertBook({
      id: 'book-b',
      title: 'Fundación',
      author: 'Isaac Asimov',
      year: 1951,
      format: 'epub',
      filePath: '/library/asimov/foundation.epub',
      contentHash: 'sha256:bbb',
      excerpt: 'El inicio de una saga galáctica.',
    })

    const rows = db.listBooks()
    expect(rows.map((r) => r.id)).toEqual(['book-b', 'book-a'])

    db.close()
  })

  it('searchBooks returns FTS5 partial matches on title', () => {
    const db = openLocalDb()

    db.insertBook({
      id: 'book-c',
      title: 'Fundación e Imperio',
      author: 'Isaac Asimov',
      year: 1952,
      format: 'epub',
      filePath: '/library/asimov/foundation-and-empire.epub',
      contentHash: 'sha256:ccc',
      excerpt: 'La caída del imperio galáctico.',
    })
    db.insertBook({
      id: 'book-d',
      title: 'Ficciones',
      author: 'Jorge Luis Borges',
      year: 1944,
      format: 'epub',
      filePath: '/library/borges/ficciones.epub',
      contentHash: 'sha256:ddd',
      excerpt: 'Cuentos que desdibujan la realidad.',
    })

    // Partial match: "ficc" must match "Ficciones" only, not "Fundación".
    const hits = db.searchBooks('ficc')
    expect(hits.map((h) => h.id)).toEqual(['book-d'])

    // Another partial match: "fundac" must match "Fundación e Imperio" only.
    const fundacion = db.searchBooks('fundac')
    expect(fundacion.map((h) => h.id)).toEqual(['book-c'])

    db.close()
  })
})
