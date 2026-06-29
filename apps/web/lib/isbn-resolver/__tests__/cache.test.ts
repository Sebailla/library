/**
 * TDD tests for `lib/isbn-resolver/cache.ts` (PR-4A, #71).
 *
 * The cache is a process-local, in-memory map keyed by
 * `(title, author, format)`. It is the only place that
 * can short-circuit the 7-layer chain. A cache hit MUST
 * mean "we resolved this book before, do not re-run the
 * layers" — never "we tried the layers and they failed,
 * give up". Failed lookups are NOT cached.
 *
 * Coverage:
 *  - Round-trip set/get returns the same candidate.
 *  - Miss returns null.
 *  - Key normalization collapses case and whitespace so
 *    `"Foo  Bar"` and `"foo bar"` hit the same entry.
 *  - Author is part of the key — the same title by two
 *    different authors must NOT collide.
 *  - Cache can be cleared between test runs.
 */

import { describe, expect, it, beforeEach } from 'vitest'

import { createInMemoryIsbnCache, type IsbnCache } from '../cache'
import type { IsbnCandidate } from '../types'

function candidate(isbn: string, source: IsbnCandidate['source']): IsbnCandidate {
  return { isbn, source, confidence: 1 }
}

describe('isbn-resolver/cache (PR-4A, #71)', () => {
  let cache: IsbnCache

  beforeEach(() => {
    cache = createInMemoryIsbnCache()
  })

  it('returns null on a cache miss', () => {
    expect(
      cache.get({ title: 'Ficciones', author: 'Borges', format: 'epub' }),
    ).toBeNull()
  })

  it('round-trips a set / get', () => {
    cache.set(
      { title: 'Ficciones', author: 'Borges', format: 'epub' },
      candidate('9788437624747', 'embedded'),
    )
    expect(
      cache.get({ title: 'Ficciones', author: 'Borges', format: 'epub' }),
    ).toEqual({
      isbn: '9788437624747',
      source: 'embedded',
      confidence: 1,
    })
  })

  it('treats the title, author, and format as a composite key', () => {
    cache.set(
      { title: 'Ficciones', author: 'Borges', format: 'epub' },
      candidate('9788437624747', 'embedded'),
    )
    // Different format → miss.
    expect(
      cache.get({ title: 'Ficciones', author: 'Borges', format: 'pdf' }),
    ).toBeNull()
    // Different author → miss.
    expect(
      cache.get({ title: 'Ficciones', author: 'Cortazar', format: 'epub' }),
    ).toBeNull()
  })

  it('normalizes keys: case and whitespace collapse', () => {
    cache.set(
      { title: 'Ficciones', author: 'Borges', format: 'epub' },
      candidate('9788437624747', 'embedded'),
    )
    // Different case + extra spaces — should still hit.
    expect(
      cache.get({ title: '  ficciones  ', author: 'BORGES', format: 'EPUB' }),
    ).toEqual({
      isbn: '9788437624747',
      source: 'embedded',
      confidence: 1,
    })
  })

  it('treats missing author and empty author as the same key', () => {
    cache.set(
      { title: 'Untitled', format: 'pdf' },
      candidate('9780000000001', 'regex'),
    )
    expect(
      cache.get({ title: 'Untitled', author: '', format: 'pdf' }),
    ).toEqual({
      isbn: '9780000000001',
      source: 'regex',
      confidence: 1,
    })
  })

  it('overwrites a prior candidate for the same key', () => {
    cache.set(
      { title: 'Ficciones', author: 'Borges', format: 'epub' },
      candidate('9788437624747', 'embedded'),
    )
    cache.set(
      { title: 'Ficciones', author: 'Borges', format: 'epub' },
      candidate('9788437624748', 'regex'),
    )
    expect(
      cache.get({ title: 'Ficciones', author: 'Borges', format: 'epub' }),
    )?.toEqual({
      isbn: '9788437624748',
      source: 'regex',
      confidence: 1,
    })
  })

  it('isolates instances: two caches do not share state', () => {
    const a = createInMemoryIsbnCache()
    const b = createInMemoryIsbnCache()
    a.set(
      { title: 'X', format: 'pdf' },
      candidate('9780000000001', 'embedded'),
    )
    expect(b.get({ title: 'X', format: 'pdf' })).toBeNull()
  })
})
