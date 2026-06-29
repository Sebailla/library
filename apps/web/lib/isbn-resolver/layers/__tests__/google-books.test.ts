/**
 * TDD tests for `lib/isbn-resolver/layers/google-books.ts` (PR-4A, #71).
 *
 * Layer 4 of the 7-layer chain. When OpenLibrary misses,
 * we ask Google Books:
 *  - GET https://www.googleapis.com/books/v1/volumes?q=<title> <author>
 *  - Walk the items[] and look at `volumeInfo.industryIdentifiers[]`
 *    for an ISBN_13 / ISBN_10 entry.
 *
 * The layer uses the `fetch` injected via `LayerContext`
 * so tests can capture and shape the request. It does
 * NOT perform live HTTP in unit tests.
 *
 * Coverage:
 *  - Happy path: ISBN_13 in industryIdentifiers wins.
 *  - Falls back to ISBN_10 and normalizes to ISBN-13.
 *  - Returns null when no items match.
 *  - Returns null when items have no industryIdentifiers.
 *  - Returns null on non-OK HTTP status.
 *  - Returns null when fetch throws.
 *  - Issues the right URL with title + author.
 */

import { describe, expect, it, vi } from 'vitest'

import { createInMemoryIsbnCache } from '../../cache'
import { extractGoogleBooksIsbn } from '../google-books'

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

describe('isbn-resolver/layers/google-books (PR-4A, #71)', () => {
  it('returns the ISBN_13 from industryIdentifiers', async () => {
    const { fetch } = makeFetch(() =>
      jsonResponse({
        totalItems: 1,
        items: [
          {
            id: 'abc',
            volumeInfo: {
              title: 'Ficciones',
              authors: ['Jorge Luis Borges'],
              industryIdentifiers: [
                { type: 'ISBN_13', identifier: '9788437624747' },
                { type: 'ISBN_10', identifier: '8437624742' },
              ],
            },
          },
        ],
      }),
    )
    const result = await extractGoogleBooksIsbn(baseBook, makeCtx(fetch))
    expect(result).toEqual({
      isbn: '9788437624747',
      source: 'googlebooks',
      confidence: 0.75,
      raw: expect.anything(),
    })
  })

  it('falls back to ISBN_10 and normalizes to ISBN-13 when ISBN_13 is absent', async () => {
    const { fetch } = makeFetch(() =>
      jsonResponse({
        totalItems: 1,
        items: [
          {
            id: 'abc',
            volumeInfo: {
              industryIdentifiers: [{ type: 'ISBN_10', identifier: '0306406152' }],
            },
          },
        ],
      }),
    )
    const result = await extractGoogleBooksIsbn(baseBook, makeCtx(fetch))
    expect(result?.isbn).toBe('9780306406157')
  })

  it('walks past items with no industryIdentifiers and returns the first valid one', async () => {
    const { fetch } = makeFetch(() =>
      jsonResponse({
        totalItems: 3,
        items: [
          { id: 'a', volumeInfo: { title: 'Other Book' } },
          { id: 'b', volumeInfo: { industryIdentifiers: [] } },
          {
            id: 'c',
            volumeInfo: {
              industryIdentifiers: [
                { type: 'ISBN_13', identifier: '9780134098654' },
              ],
            },
          },
        ],
      }),
    )
    const result = await extractGoogleBooksIsbn(baseBook, makeCtx(fetch))
    expect(result?.isbn).toBe('9780134098654')
  })

  it('returns null when no items match', async () => {
    const { fetch } = makeFetch(() =>
      jsonResponse({ totalItems: 0, items: [] }),
    )
    const result = await extractGoogleBooksIsbn(baseBook, makeCtx(fetch))
    expect(result).toBeNull()
  })

  it('returns null when no item carries an industryIdentifier', async () => {
    const { fetch } = makeFetch(() =>
      jsonResponse({
        totalItems: 2,
        items: [
          { id: 'a', volumeInfo: { title: 'Other' } },
          { id: 'b', volumeInfo: { industryIdentifiers: [] } },
        ],
      }),
    )
    const result = await extractGoogleBooksIsbn(baseBook, makeCtx(fetch))
    expect(result).toBeNull()
  })

  it('returns null on a non-OK HTTP status', async () => {
    const { fetch } = makeFetch(() => new Response('nope', { status: 500 }))
    const result = await extractGoogleBooksIsbn(baseBook, makeCtx(fetch))
    expect(result).toBeNull()
  })

  it('returns null when fetch throws', async () => {
    const fetch: typeof globalThis.fetch = vi.fn(async () => {
      throw new Error('dns down')
    }) as unknown as typeof fetch
    const result = await extractGoogleBooksIsbn(baseBook, makeCtx(fetch))
    expect(result).toBeNull()
  })

  it('issues a GET to googleapis.com/books/v1/volumes with the title and author', async () => {
    const { fetch, calls } = makeFetch(() =>
      jsonResponse({ totalItems: 0, items: [] }),
    )
    await extractGoogleBooksIsbn(baseBook, makeCtx(fetch))
    const url = new URL(calls[0]!.url)
    expect(url.host).toBe('www.googleapis.com')
    expect(url.pathname).toBe('/books/v1/volumes')
    const q = url.searchParams.get('q') ?? ''
    expect(q).toContain('Ficciones')
    expect(q.toLowerCase()).toContain('borges')
  })

  it('ignores identifier entries that fail the checksum', async () => {
    const { fetch } = makeFetch(() =>
      jsonResponse({
        totalItems: 1,
        items: [
          {
            volumeInfo: {
              industryIdentifiers: [
                { type: 'ISBN_13', identifier: '9780306406158' }, // bad check
                { type: 'ISBN_10', identifier: '0306406152' },
              ],
            },
          },
        ],
      }),
    )
    const result = await extractGoogleBooksIsbn(baseBook, makeCtx(fetch))
    expect(result?.isbn).toBe('9780306406157')
  })
})
