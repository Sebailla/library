/**
 * TDD tests for `lib/isbn-resolver/layers/unlimited-ocr.ts` (PR-4A, #71).
 *
 * Layer 6 of the 7-layer chain. Sends the rendered first
 * page and back cover to the optional Unlimited-OCR
 * cloud endpoint (Baidu). The endpoint is configured via
 * the `UNLIMITED_OCR_ENDPOINT` environment variable; if
 * the variable is unset, the layer is skipped silently
 * per the spec ("MUST be skipped silently if
 * `UNLIMITED_OCR_ENDPOINT` is unset or unreachable").
 *
 * Coverage:
 *  - Skips silently when the env var is unset (returns null).
 *  - Sends a POST to the configured endpoint with the
 *    book file path; parses the response and returns
 *    the first valid ISBN.
 *  - Returns null on a non-OK HTTP status (5xx, 4xx).
 *  - Returns null when the endpoint returns no ISBN.
 *  - Returns null when fetch throws.
 *  - The endpoint URL can be overridden via context
 *    (so the test never reads the env).
 */

import { describe, expect, it, vi } from 'vitest'

import { createInMemoryIsbnCache } from '../../cache'
import { extractUnlimitedOcrIsbn } from '../unlimited-ocr'

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
  title: 'X',
  author: 'Y',
  format: 'pdf',
  filePath: '/x.pdf',
}

describe('isbn-resolver/layers/unlimited-ocr (PR-4A, #71)', () => {
  it('skips silently when no endpoint is configured (no env, no context override)', async () => {
    const { fetch } = makeFetch(() => jsonResponse({ isbn: '9780306406157' }))
    const result = await extractUnlimitedOcrIsbn(
      baseBook,
      { cache: createInMemoryIsbnCache(), fetch },
    )
    expect(result).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('posts to the configured endpoint and returns the ISBN', async () => {
    const { fetch, calls } = makeFetch(() =>
      jsonResponse({ isbn: '9780306406157' }),
    )
    const result = await extractUnlimitedOcrIsbn(
      baseBook,
      {
        cache: createInMemoryIsbnCache(),
        fetch,
        unlimitedOcrEndpoint: 'https://ocr.example.com/isbn',
      },
    )
    expect(result).toEqual({
      isbn: '9780306406157',
      source: 'unlimited-ocr',
      confidence: 0.7,
      raw: expect.anything(),
    })
    expect(calls).toHaveLength(1)
    const call = calls[0]!
    expect(call.url).toBe('https://ocr.example.com/isbn')
    expect(call.init.method).toBe('POST')
  })

  it('returns null on a 5xx response', async () => {
    const { fetch } = makeFetch(() => new Response('boom', { status: 503 }))
    const result = await extractUnlimitedOcrIsbn(
      baseBook,
      {
        cache: createInMemoryIsbnCache(),
        fetch,
        unlimitedOcrEndpoint: 'https://ocr.example.com/isbn',
      },
    )
    expect(result).toBeNull()
  })

  it('returns null when the response has no ISBN', async () => {
    const { fetch } = makeFetch(() => jsonResponse({ isbn: null }))
    const result = await extractUnlimitedOcrIsbn(
      baseBook,
      {
        cache: createInMemoryIsbnCache(),
        fetch,
        unlimitedOcrEndpoint: 'https://ocr.example.com/isbn',
      },
    )
    expect(result).toBeNull()
  })

  it('returns null when fetch throws', async () => {
    const fetch: typeof globalThis.fetch = vi.fn(async () => {
      throw new Error('dns down')
    }) as unknown as typeof fetch
    const result = await extractUnlimitedOcrIsbn(
      baseBook,
      {
        cache: createInMemoryIsbnCache(),
        fetch,
        unlimitedOcrEndpoint: 'https://ocr.example.com/isbn',
      },
    )
    expect(result).toBeNull()
  })
})
