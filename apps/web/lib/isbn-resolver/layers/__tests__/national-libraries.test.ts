/**
 * TDD tests for `lib/isbn-resolver/layers/national-libraries.ts` (PR-4A, #71).
 *
 * Layer 7 of the 7-layer chain. Asks the configured
 * national libraries for a fuzzy match by title + author.
 * The supported providers in PR-4A are:
 *  - Library of Congress (id: 'loc')
 *  - Biblioteca Nacional de España (id: 'bne')
 *  - Biblioteca Nacional de la República Argentina (id: 'bn-argentina')
 *
 * Each provider exposes a `lookup` endpoint; the layer
 * tries them in a fixed order and returns the first
 * checksum-valid ISBN. The `fetch` is injected via
 * `LayerContext.fetch` so tests can capture requests
 * deterministically.
 *
 * Coverage:
 *  - LoC returns an ISBN → candidate.
 *  - LoC misses, BNE returns → candidate from BNE.
 *  - All providers miss → null.
 *  - LoC returns 5xx → falls through to BNE.
 *  - LoC throws → falls through to BNE.
 *  - Skips providers whose endpoint is unset.
 *  - Skips providers whose response has no ISBN.
 */

import { describe, expect, it, vi } from 'vitest'

import { createInMemoryIsbnCache } from '../../cache'
import { extractNationalLibrariesIsbn } from '../national-libraries'

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

const baseBook = {
  title: 'Ficciones',
  author: 'Jorge Luis Borges',
  format: 'epub',
  filePath: '/x.epub',
}

describe('isbn-resolver/layers/national-libraries (PR-4A, #71)', () => {
  it('returns the LoC ISBN when LoC has a hit', async () => {
    const { fetch, calls } = makeFetch(() =>
      jsonResponse({ isbn: '9788437624747' }),
    )
    const result = await extractNationalLibrariesIsbn(baseBook, {
      cache: createInMemoryIsbnCache(),
      fetch,
      nationalLibraryEndpoints: {
        loc: 'https://loc.gov/isbn',
      },
    })
    expect(result?.isbn).toBe('9788437624747')
    expect(result?.source).toBe('national-libraries')
    expect(calls).toHaveLength(1)
  })

  it('falls through to BNE when LoC misses', async () => {
    const responses: string[] = []
    const { fetch } = makeFetch(({ url }) => {
      responses.push(url)
      if (url.includes('loc.gov')) return jsonResponse({ isbn: null })
      if (url.includes('bne.es')) return jsonResponse({ isbn: '9788437624747' })
      return jsonResponse({ isbn: null })
    })
    const result = await extractNationalLibrariesIsbn(baseBook, {
      cache: createInMemoryIsbnCache(),
      fetch,
      nationalLibraryEndpoints: {
        loc: 'https://loc.gov/isbn',
        bne: 'https://bne.es/isbn',
      },
    })
    expect(result?.isbn).toBe('9788437624747')
    expect(responses).toContain('https://loc.gov/isbn')
    expect(responses).toContain('https://bne.es/isbn')
  })

  it('falls through to BNE when LoC returns 5xx', async () => {
    const { fetch } = makeFetch(({ url }) => {
      if (url.includes('loc.gov')) return new Response('down', { status: 503 })
      if (url.includes('bne.es')) return jsonResponse({ isbn: '9788437624747' })
      return jsonResponse({ isbn: null })
    })
    const result = await extractNationalLibrariesIsbn(baseBook, {
      cache: createInMemoryIsbnCache(),
      fetch,
      nationalLibraryEndpoints: {
        loc: 'https://loc.gov/isbn',
        bne: 'https://bne.es/isbn',
      },
    })
    expect(result?.isbn).toBe('9788437624747')
  })

  it('falls through to BNE when LoC throws', async () => {
    const calls: string[] = []
    const fetch: typeof globalThis.fetch = vi.fn(async (input) => {
      const url = typeof input === 'string' ? input : input.toString()
      calls.push(url)
      if (url.includes('loc.gov')) throw new Error('dns')
      if (url.includes('bne.es')) return jsonResponse({ isbn: '9788437624747' })
      return jsonResponse({ isbn: null })
    }) as unknown as typeof fetch
    const result = await extractNationalLibrariesIsbn(baseBook, {
      cache: createInMemoryIsbnCache(),
      fetch,
      nationalLibraryEndpoints: {
        loc: 'https://loc.gov/isbn',
        bne: 'https://bne.es/isbn',
      },
    })
    expect(result?.isbn).toBe('9788437624747')
  })

  it('returns null when no provider has a hit', async () => {
    const { fetch } = makeFetch(() => jsonResponse({ isbn: null }))
    const result = await extractNationalLibrariesIsbn(baseBook, {
      cache: createInMemoryIsbnCache(),
      fetch,
      nationalLibraryEndpoints: {
        loc: 'https://loc.gov/isbn',
        bne: 'https://bne.es/isbn',
      },
    })
    expect(result).toBeNull()
  })

  it('skips providers whose endpoint is unset (no env, no context override)', async () => {
    const { fetch, calls } = makeFetch(() => jsonResponse({ isbn: null }))
    const result = await extractNationalLibrariesIsbn(baseBook, {
      cache: createInMemoryIsbnCache(),
      fetch,
      nationalLibraryEndpoints: { bne: 'https://bne.es/isbn' },
    })
    expect(result).toBeNull()
    // LoC was not configured; we should not have called it.
    expect(calls.every((c) => !c.url.includes('loc.gov'))).toBe(true)
  })
})
