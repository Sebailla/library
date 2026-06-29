/**
 * TDD tests for `lib/isbn-resolver/resolve.ts` (PR-4A, #71).
 *
 * The orchestrator. Walks the 7-layer chain in priority
 * order, stopping at the first layer that returns a
 * non-null candidate. A cache hit short-circuits the
 * whole chain — no layer is invoked.
 *
 * Coverage:
 *  - Layer 1 hits → no calls to any other layer.
 *  - Layer 1 null → layer 2; layer 2 null → layer 3 …
 *  - All layers null → orchestrator returns null and
 *    does NOT cache the failure.
 *  - Cache hit short-circuits the chain.
 *  - A layer that throws is treated as null (chain
 *    continues to the next layer).
 *  - The orchestrator writes the successful candidate
 *    to the cache.
 *  - The orchestrator returns a `BookMetadata` with the
 *    `isbn` and `isbnSource` filled in on success.
 */

import { describe, expect, it, vi } from 'vitest'

import { createInMemoryIsbnCache } from '../cache'
import { resolve, resolveCached } from '../resolve'
import type { BookInput, IsbnCandidate, Layer, LayerContext } from '../types'

const baseBook: BookInput = {
  title: 'Ficciones',
  author: 'Jorge Luis Borges',
  format: 'epub',
  filePath: '/x.epub',
}

/** Construct a stub layer that always returns the given candidate. */
function stub(name: string, value: IsbnCandidate | null): Layer {
  return async (_book, ctx) => {
    calls.push({ name, ctx })
    return value
  }
}

/** Construct a stub layer that always throws. */
function thrower(name: string): Layer {
  return async (_book, ctx) => {
    calls.push({ name, ctx })
    throw new Error(`${name} exploded`)
  }
}

let calls: { name: string; ctx: LayerContext }[]

function makeCtx(layers: Layer[]) {
  calls = []
  const cache = createInMemoryIsbnCache()
  return { cache, layers }
}

describe('isbn-resolver/resolve (PR-4A, #71)', () => {
  it('returns layer 1 result and never invokes the other layers', async () => {
    const { cache, layers } = makeCtx([
      stub('embedded', { isbn: '9780306406157', source: 'embedded', confidence: 1 }),
      stub('regex', { isbn: '9780134098654', source: 'regex', confidence: 0.9 }),
      stub('openlibrary', { isbn: '9788437624747', source: 'openlibrary', confidence: 0.8 }),
      stub('googlebooks', null),
      stub('vision-ocr', null),
      stub('unlimited-ocr', null),
      stub('national-libraries', null),
    ])
    const result = await resolve(baseBook, { cache, layers })
    expect(result?.isbn).toBe('9780306406157')
    expect(result?.isbnSource).toBe('embedded')
    expect(calls.map((c) => c.name)).toEqual(['embedded'])
  })

  it('falls through to layer 2 when layer 1 is null', async () => {
    const { cache, layers } = makeCtx([
      stub('embedded', null),
      stub('regex', { isbn: '9780134098654', source: 'regex', confidence: 0.9 }),
      stub('openlibrary', null),
      stub('googlebooks', null),
      stub('vision-ocr', null),
      stub('unlimited-ocr', null),
      stub('national-libraries', null),
    ])
    const result = await resolve(baseBook, { cache, layers })
    expect(result?.isbn).toBe('9780134098654')
    expect(result?.isbnSource).toBe('regex')
    expect(calls.map((c) => c.name)).toEqual(['embedded', 'regex'])
  })

  it('falls through to layer 3 when layers 1 and 2 are null', async () => {
    const { cache, layers } = makeCtx([
      stub('embedded', null),
      stub('regex', null),
      stub('openlibrary', { isbn: '9788437624747', source: 'openlibrary', confidence: 0.8 }),
      stub('googlebooks', null),
      stub('vision-ocr', null),
      stub('unlimited-ocr', null),
      stub('national-libraries', null),
    ])
    const result = await resolve(baseBook, { cache, layers })
    expect(result?.isbn).toBe('9788437624747')
    expect(result?.isbnSource).toBe('openlibrary')
  })

  it('returns null when every layer returns null and does not cache the failure', async () => {
    const { cache, layers } = makeCtx([
      stub('embedded', null),
      stub('regex', null),
      stub('openlibrary', null),
      stub('googlebooks', null),
      stub('vision-ocr', null),
      stub('unlimited-ocr', null),
      stub('national-libraries', null),
    ])
    const result = await resolve(baseBook, { cache, layers })
    expect(result).toBeNull()
    // Failure is NOT cached.
    expect(
      cache.get({ title: baseBook.title, author: baseBook.author, format: baseBook.format }),
    ).toBeNull()
  })

  it('short-circuits the chain on a cache hit (no layer is invoked)', async () => {
    const { cache, layers } = makeCtx([
      stub('embedded', { isbn: '9789999999999', source: 'embedded', confidence: 1 }),
      stub('regex', { isbn: '9788888888888', source: 'regex', confidence: 0.9 }),
      stub('openlibrary', null),
      stub('googlebooks', null),
      stub('vision-ocr', null),
      stub('unlimited-ocr', null),
      stub('national-libraries', null),
    ])
    // Prime the cache.
    cache.set(
      { title: baseBook.title, author: baseBook.author, format: baseBook.format },
      { isbn: '9780306406157', source: 'embedded', confidence: 1 },
    )
    const result = await resolve(baseBook, { cache, layers })
    expect(result?.isbn).toBe('9780306406157')
    expect(calls).toEqual([]) // no layer was invoked
  })

  it('treats a thrown layer as null and continues the chain', async () => {
    const { cache, layers } = makeCtx([
      thrower('embedded'),
      thrower('regex'),
      stub('openlibrary', { isbn: '9788437624747', source: 'openlibrary', confidence: 0.8 }),
      stub('googlebooks', null),
      stub('vision-ocr', null),
      stub('unlimited-ocr', null),
      stub('national-libraries', null),
    ])
    const result = await resolve(baseBook, { cache, layers })
    expect(result?.isbn).toBe('9788437624747')
  })

  it('writes the successful candidate to the cache', async () => {
    const { cache, layers } = makeCtx([
      stub('embedded', null),
      stub('regex', { isbn: '9780134098654', source: 'regex', confidence: 0.9 }),
      stub('openlibrary', null),
      stub('googlebooks', null),
      stub('vision-ocr', null),
      stub('unlimited-ocr', null),
      stub('national-libraries', null),
    ])
    await resolve(baseBook, { cache, layers })
    expect(
      cache.get({ title: baseBook.title, author: baseBook.author, format: baseBook.format }),
    ).toEqual({
      isbn: '9780134098654',
      source: 'regex',
      confidence: 0.9,
    })
  })

  it('returns the original book fields in BookMetadata (title, author, format, filePath)', async () => {
    const { cache, layers } = makeCtx([
      stub('embedded', { isbn: '9780306406157', source: 'embedded', confidence: 1 }),
      stub('regex', null),
      stub('openlibrary', null),
      stub('googlebooks', null),
      stub('vision-ocr', null),
      stub('unlimited-ocr', null),
      stub('national-libraries', null),
    ])
    const result = await resolve(baseBook, { cache, layers })
    expect(result?.title).toBe(baseBook.title)
    expect(result?.author).toBe(baseBook.author)
    expect(result?.format).toBe(baseBook.format)
    expect(result?.filePath).toBe(baseBook.filePath)
  })

  describe('resolveCached', () => {
    it('returns a single BookMetadata even when the same book is requested twice', async () => {
      const { cache, layers } = makeCtx([
        stub('embedded', { isbn: '9780306406157', source: 'embedded', confidence: 1 }),
        stub('regex', null),
        stub('openlibrary', null),
        stub('googlebooks', null),
        stub('vision-ocr', null),
        stub('unlimited-ocr', null),
        stub('national-libraries', null),
      ])
      const r1 = await resolveCached(baseBook, { cache, layers })
      const r2 = await resolveCached(baseBook, { cache, layers })
      expect(r1?.isbn).toBe('9780306406157')
      expect(r2?.isbn).toBe('9780306406157')
      // Only the first call touched the layers.
      expect(calls.length).toBe(1)
    })
  })
})
