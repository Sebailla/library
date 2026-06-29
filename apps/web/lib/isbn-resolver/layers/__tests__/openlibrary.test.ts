/**
 * TDD tests for `lib/isbn-resolver/layers/openlibrary.ts` (PR-4A, #71).
 *
 * Layer 3 of the 7-layer chain. When the file does not
 * expose its ISBN, we ask OpenLibrary:
 *  - GET https://openlibrary.org/search.json?q=<title> <author>
 *  - Look for `isbn[]` in the first hit that matches
 *    the title+author query.
 *  - Normalize the first ISBN via `normalizeIsbn` and
 *    return it.
 *
 * The layer uses the `fetch` injected via `LayerContext`
 * so tests can capture and shape the request. It does
 * NOT perform live HTTP in unit tests.
 *
 * Coverage:
 *  - Happy path: title+author hit returns ISBN.
 *  - Title-only hit (no author) still works.
 *  - Empty search results → null.
 *  - Fetch error → null (chain falls through).
 *  - First hit with no isbn[] → null.
 *  - Multiple isbn[] entries: the first valid one wins.
 *  - Non-OK HTTP status → null.
 *  - Calls the right URL with the right query.
 */

import { describe, expect, it, vi } from 'vitest'

import { createInMemoryIsbnCache } from '../../cache'
import { extractOpenLibraryIsbn } from '../openlibrary'

interface FetchCall {
  url: string
  init: RequestInit
}

function makeFetch(responder: (call: FetchCall) => Response | Promise<Response>) {
  const calls: FetchCall[] = []
  const mocked = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    calls.push({ url, init: init ?? {} })
    return responder({ url, init: init ?? {} })
  }) as unknown as typeof fetch
  return { fetch: mocked, calls }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function makeCtx(fetch: typeof globalThis.fetch) {
  return { cache: createInMemoryIsbnCache(), fetch }
}

const baseBook = {
  title: 'Ficciones',
  author: 'Jorge Luis Borges',
  format: 'epub',
  filePath: '/x.epub',
}

describe('isbn-resolver/layers/openlibrary (PR-4A, #71)', () => {
  it('returns the ISBN from the first hit that has one', async () => {
    const { fetch, calls } = makeFetch(() =>
      jsonResponse({
        numFound: 1,
        docs: [
          {
            title: 'Ficciones',
            author_name: ['Jorge Luis Borges'],
            isbn: ['9788437624747', '9780142437889'],
          },
        ],
      }),
    )
    const result = await extractOpenLibraryIsbn(baseBook, makeCtx(fetch))
    expect(result).toEqual({
      isbn: '9788437624747',
      source: 'openlibrary',
      confidence: 0.8,
      raw: expect.anything(),
    })
    expect(calls).toHaveLength(1)
  })

  it('issues a GET to openlibrary.org/search.json with the title and author', async () => {
    const { fetch, calls } = makeFetch(() =>
      jsonResponse({ numFound: 0, docs: [] }),
    )
    await extractOpenLibraryIsbn(baseBook, makeCtx(fetch))
    const url = new URL(calls[0]!.url)
    expect(url.host).toBe('openlibrary.org')
    expect(url.pathname).toBe('/search.json')
    const q = url.searchParams.get('q') ?? ''
    expect(q).toContain('Ficciones')
    expect(q.toLowerCase()).toContain('borges')
  })

  it('omits the author from the query when not provided', async () => {
    const { fetch, calls } = makeFetch(() =>
      jsonResponse({ numFound: 0, docs: [] }),
    )
    await extractOpenLibraryIsbn(
      { ...baseBook, author: undefined },
      makeCtx(fetch),
    )
    const url = new URL(calls[0]!.url)
    expect(url.searchParams.get('q')).toBe('Ficciones')
  })

  it('returns null when the search has zero hits', async () => {
    const { fetch } = makeFetch(() => jsonResponse({ numFound: 0, docs: [] }))
    const result = await extractOpenLibraryIsbn(baseBook, makeCtx(fetch))
    expect(result).toBeNull()
  })

  it('returns null when the first hit has no isbn[]', async () => {
    const { fetch } = makeFetch(() =>
      jsonResponse({
        numFound: 2,
        docs: [
          { title: 'Ficciones', author_name: ['Borges'] }, // no isbn
        ],
      }),
    )
    const result = await extractOpenLibraryIsbn(baseBook, makeCtx(fetch))
    expect(result).toBeNull()
  })

  it('skips a hit without isbn[] and returns the next valid one', async () => {
    const { fetch } = makeFetch(() =>
      jsonResponse({
        numFound: 2,
        docs: [
          { title: 'Ficciones', author_name: ['Borges'] },
          { title: 'Ficciones', author_name: ['Borges'], isbn: ['9788437624747'] },
        ],
      }),
    )
    const result = await extractOpenLibraryIsbn(baseBook, makeCtx(fetch))
    expect(result?.isbn).toBe('9788437624747')
  })

  it('ignores isbn-shaped strings that fail the checksum', async () => {
    const { fetch } = makeFetch(() =>
      jsonResponse({
        numFound: 1,
        docs: [
          { isbn: ['9780306406158', '9788437624747'] }, // first fails, second valid
        ],
      }),
    )
    const result = await extractOpenLibraryIsbn(baseBook, makeCtx(fetch))
    expect(result?.isbn).toBe('9788437624747')
  })

  it('returns null on a non-OK HTTP status', async () => {
    const { fetch } = makeFetch(() => new Response('boom', { status: 503 }))
    const result = await extractOpenLibraryIsbn(baseBook, makeCtx(fetch))
    expect(result).toBeNull()
  })

  it('returns null when fetch throws', async () => {
    const fetch: typeof globalThis.fetch = vi.fn(async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch
    const result = await extractOpenLibraryIsbn(baseBook, makeCtx(fetch))
    expect(result).toBeNull()
  })

  it('uses the global fetch when none is injected', async () => {
    // Inject a global fetch just for this test, then restore.
    const original = globalThis.fetch
    const stub = vi.fn(async () =>
      jsonResponse({
        numFound: 1,
        docs: [{ isbn: ['9788437624747'] }],
      }),
    ) as unknown as typeof fetch
    globalThis.fetch = stub
    try {
      const result = await extractOpenLibraryIsbn(baseBook, {
        cache: createInMemoryIsbnCache(),
      })
      expect(result?.isbn).toBe('9788437624747')
      expect(stub).toHaveBeenCalledTimes(1)
    } finally {
      globalThis.fetch = original
    }
  })
})
