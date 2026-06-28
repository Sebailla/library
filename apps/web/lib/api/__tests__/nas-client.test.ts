import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'

import {
  createNasClient,
  type NasClientOptions,
  type NasPairRequest,
  type NasPairResponse,
  type NasStartDownloadRequest,
} from '../nas-client'

/**
 * Read a request header in a jsdom-safe way. The jsdom `Headers`
 * implementation is incomplete (it returns `null` for keys set via
 * the plain-object form), so we read directly from the recorded
 * `init.headers` record when it is a plain object, falling back to
 * `Headers.get` for the rare `Headers` instance.
 */
function headerOf(call: FetchCall, name: string): string | null {
  const raw = call.init.headers as Record<string, string> | Headers | undefined
  if (!raw) return null
  if (typeof (raw as Headers).get === 'function') {
    return (raw as Headers).get(name)
  }
  // Case-insensitive lookup over a plain record.
  const record = raw as Record<string, string>
  const match = Object.keys(record).find((k) => k.toLowerCase() === name.toLowerCase())
  return match ? (record[match] ?? null) : null
}

/**
 * TDD tests for `lib/api/nas-client.ts` (PR-3C).
 *
 * The NAS client is the wire-level bridge to the PR2 NestJS
 * backend. Every endpoint is exercised with a mocked `fetch` so
 * the client is verifiable without a running backend.
 *
 * Endpoint coverage (PR-3C):
 *  - pair  (POST /api/auth/pair)  → mints a JWT
 *  - refresh (POST /api/auth/refresh)  → rotates the JWT
 *  - listBooks  (GET /api/books)
 *  - getBook  (GET /api/books/:id)
 *  - search  (GET /api/search)
 *  - listCategories  (GET /api/categories)
 *  - getDiscoveryInfo  (GET /api/discovery/info)  (pre-auth)
 *  - getDiscoveryNetwork  (GET /api/discovery/network)  (auth)
 *  - startDownload  (POST /api/downloads)
 *  - completeDownload  (PATCH /api/downloads/:id)
 *  - downloadFile  (GET /api/files/:id, Range)
 */

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

function emptyResponse(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers })
}

interface FetchCall {
  url: string
  init: RequestInit
}

function makeFetchRecorder(
  responder: (call: FetchCall) => Response | Promise<Response>,
): { fetch: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = []
  const mocked: typeof fetch = vi.fn(async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString()
    calls.push({ url, init: init ?? {} })
    return responder({ url, init: init ?? {} })
  }) as unknown as typeof fetch
  return { fetch: mocked, calls }
}

describe('nas-client (PR-3C)', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    // Wipe any lingering env override between tests so a stray
    // ALEJANDRIA_NAS_URL set by an earlier test does not leak.
    delete process.env['ALEJANDRIA_NAS_URL']
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  describe('pair', () => {
    it('POSTs to /api/auth/pair with the PIN and device name', async () => {
      const pairResponse: NasPairResponse = {
        token: 'jwt-token-1',
        expires_at: '2026-12-31T23:59:59Z',
        device_id: 'device-xyz',
      }
      const { fetch, calls } = makeFetchRecorder((call) => {
        return jsonResponse(pairResponse)
      })
      const client = createNasClient({ fetch, baseUrl: 'http://nas.local:3000' })

      const request: NasPairRequest = { pin: '123456', deviceName: 'MacBook Pro' }
      const result = await client.pair(request)

      expect(calls).toHaveLength(1)
      expect(calls[0]!.url).toBe('http://nas.local:3000/api/auth/pair')
      expect(calls[0]!.init.method).toBe('POST')
      // The wire format is snake_case (`device_name`) to match the
      // PR-2 `PairDto` — assert the actual payload, not the typed
      // input.
      expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
        pin: '123456',
        device_name: 'MacBook Pro',
      })
      expect(result).toEqual(pairResponse)
    })

    it('does NOT send an Authorization header (pair is pre-auth)', async () => {
      const { fetch, calls } = makeFetchRecorder(() =>
        jsonResponse({ token: 'jwt', expires_at: 'x', device_id: 'd' }),
      )
      const client = createNasClient({ fetch, baseUrl: 'http://nas.local:3000' })

      await client.pair({ pin: '111', deviceName: 'iPad' })

      expect(headerOf(calls[0]!, 'authorization')).toBeNull()
    })

    it('throws when the server returns 4xx', async () => {
      const { fetch } = makeFetchRecorder(() =>
        jsonResponse(
          { error: { code: 'INVALID_PIN', message: 'bad pin' } },
          { status: 401 },
        ),
      )
      const client = createNasClient({ fetch, baseUrl: 'http://nas.local:3000' })

      await expect(
        client.pair({ pin: '000000', deviceName: 'X' }),
      ).rejects.toThrow(/INVALID_PIN|401/)
    })
  })

  describe('refresh', () => {
    it('POSTs the current token to /api/auth/refresh', async () => {
      const { fetch, calls } = makeFetchRecorder(() =>
        jsonResponse({
          token: 'jwt-2',
          expires_at: '2027-01-01T00:00:00Z',
          device_id: 'device-xyz',
        }),
      )
      const client = createNasClient({
        fetch,
        baseUrl: 'http://nas.local:3000',
        token: 'jwt-1',
      })

      const result = await client.refresh()

      expect(calls[0]!.url).toBe('http://nas.local:3000/api/auth/refresh')
      expect(calls[0]!.init.method).toBe('POST')
      expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ token: 'jwt-1' })
      expect(result.token).toBe('jwt-2')
    })

    it('throws when no token is configured', async () => {
      const { fetch } = makeFetchRecorder(() => jsonResponse({}))
      const client = createNasClient({ fetch, baseUrl: 'http://nas.local:3000' })
      await expect(client.refresh()).rejects.toThrow(/token/i)
    })
  })

  describe('listBooks', () => {
    it('GETs /api/books with pagination and filters as query params', async () => {
      const { fetch, calls } = makeFetchRecorder(() =>
        jsonResponse({ data: [], page: 1, limit: 20, total: 0 }),
      )
      const client = createNasClient({
        fetch,
        baseUrl: 'http://nas.local:3000',
        token: 'jwt',
      })

      await client.listBooks({ page: 2, limit: 10, authorId: 42, format: 'pdf', language: 'es' })

      const url = new URL(calls[0]!.url)
      expect(url.pathname).toBe('/api/books')
      expect(url.searchParams.get('page')).toBe('2')
      expect(url.searchParams.get('limit')).toBe('10')
      expect(url.searchParams.get('author_id')).toBe('42')
      expect(url.searchParams.get('format')).toBe('pdf')
      expect(url.searchParams.get('language')).toBe('es')
    })

    it('attaches the bearer token as Authorization', async () => {
      const { fetch, calls } = makeFetchRecorder(() =>
        jsonResponse({ data: [], page: 1, limit: 20, total: 0 }),
      )
      const client = createNasClient({
        fetch,
        baseUrl: 'http://nas.local:3000',
        token: 'jwt-abc',
      })

      await client.listBooks({})

      expect(headerOf(calls[0]!, 'authorization')).toBe('Bearer jwt-abc')
    })

    it('omits query params when filters are not provided', async () => {
      const { fetch, calls } = makeFetchRecorder(() =>
        jsonResponse({ data: [], page: 1, limit: 20, total: 0 }),
      )
      const client = createNasClient({
        fetch,
        baseUrl: 'http://nas.local:3000',
        token: 'jwt',
      })

      await client.listBooks({})

      const url = new URL(calls[0]!.url)
      expect(url.search).toBe('')
    })
  })

  describe('getBook', () => {
    it('GETs /api/books/:id', async () => {
      const bookDetail = {
        id: 7,
        title: 'Ficciones',
        author_id: 1,
        year: 1944,
        language: 'es',
        format: 'pdf',
        file_path: '/library/ficciones.pdf',
        cover_path: null,
        excerpt: null,
        indexed_at: '2025-01-01T00:00:00Z',
        file_size_bytes: 1234,
        content_hash: 'sha256:abc',
        categories: [],
        sagas: [],
      }
      const { fetch, calls } = makeFetchRecorder(() => jsonResponse(bookDetail))
      const client = createNasClient({
        fetch,
        baseUrl: 'http://nas.local:3000',
        token: 'jwt',
      })

      const result = await client.getBook(7)

      expect(calls[0]!.url).toBe('http://nas.local:3000/api/books/7')
      expect(calls[0]!.init.method).toBe('GET')
      expect(result.id).toBe(7)
    })
  })

  describe('search', () => {
    it('GETs /api/search with q + limit + offset', async () => {
      const { fetch, calls } = makeFetchRecorder(() =>
        jsonResponse({ data: [], total: 0, limit: 20, offset: 0 }),
      )
      const client = createNasClient({
        fetch,
        baseUrl: 'http://nas.local:3000',
        token: 'jwt',
      })

      await client.search('ficciones', { limit: 5, offset: 10 })

      const url = new URL(calls[0]!.url)
      expect(url.pathname).toBe('/api/search')
      expect(url.searchParams.get('q')).toBe('ficciones')
      expect(url.searchParams.get('limit')).toBe('5')
      expect(url.searchParams.get('offset')).toBe('10')
    })

    it('encodes the query string', async () => {
      const { fetch, calls } = makeFetchRecorder(() =>
        jsonResponse({ data: [], total: 0, limit: 20, offset: 0 }),
      )
      const client = createNasClient({
        fetch,
        baseUrl: 'http://nas.local:3000',
        token: 'jwt',
      })

      await client.search('cien años de soledad', {})

      const url = new URL(calls[0]!.url)
      expect(url.searchParams.get('q')).toBe('cien años de soledad')
    })
  })

  describe('listCategories', () => {
    it('GETs /api/categories', async () => {
      const { fetch, calls } = makeFetchRecorder(() =>
        jsonResponse({ data: [] }),
      )
      const client = createNasClient({
        fetch,
        baseUrl: 'http://nas.local:3000',
        token: 'jwt',
      })

      await client.listCategories()

      expect(calls[0]!.url).toBe('http://nas.local:3000/api/categories')
      expect(calls[0]!.init.method).toBe('GET')
    })
  })

  describe('discovery', () => {
    it('getDiscoveryInfo hits the pre-auth /api/discovery/info', async () => {
      const { fetch, calls } = makeFetchRecorder(() =>
        jsonResponse({ mdns_name: 'alejandria._tcp.local', port: 3000 }),
      )
      const client = createNasClient({ fetch, baseUrl: 'http://nas.local:3000' })

      const result = await client.getDiscoveryInfo()

      expect(calls[0]!.url).toBe('http://nas.local:3000/api/discovery/info')
      expect(result.mdns_name).toBe('alejandria._tcp.local')
    })

    it('getDiscoveryNetwork requires a bearer token', async () => {
      const { fetch, calls } = makeFetchRecorder(() =>
        jsonResponse({ tailscale_ip: '100.0.0.1', lan_ips: [] }),
      )
      const client = createNasClient({
        fetch,
        baseUrl: 'http://nas.local:3000',
        token: 'jwt',
      })

      await client.getDiscoveryNetwork()

      expect(headerOf(calls[0]!, 'authorization')).toBe('Bearer jwt')
    })
  })

  describe('downloads', () => {
    it('startDownload POSTs the tracking envelope to /api/downloads', async () => {
      const { fetch, calls } = makeFetchRecorder(() =>
        jsonResponse({ download_id: 99, resume_supported: true }, { status: 201 }),
      )
      const client = createNasClient({
        fetch,
        baseUrl: 'http://nas.local:3000',
        token: 'jwt',
      })

      const result = await client.startDownload({
        bookId: 7,
        deviceId: 'device-1',
        deviceName: 'iPad',
        userId: 'user-1',
        fileSizeBytes: 1_000_000,
      } satisfies NasStartDownloadRequest)

      expect(calls[0]!.url).toBe('http://nas.local:3000/api/downloads')
      expect(calls[0]!.init.method).toBe('POST')
      // Wire shape is snake_case (PR-2E) — assert the actual payload.
      const body = JSON.parse(calls[0]!.init.body as string)
      expect(body).toEqual({
        book_id: 7,
        device_id: 'device-1',
        device_name: 'iPad',
        user_id: 'user-1',
        file_size_bytes: 1_000_000,
      })
      expect(result).toEqual({ download_id: 99, resume_supported: true })
    })

    it('completeDownload PATCHes /api/downloads/:id with the final byte count', async () => {
      const { fetch, calls } = makeFetchRecorder(() =>
        jsonResponse({
          id: 99,
          completed: true,
          bytes_transferred: 1_000_000,
          book_id: 7,
          device_id: 'device-1',
          downloaded_at: '2026-06-28T18:00:00Z',
        }),
      )
      const client = createNasClient({
        fetch,
        baseUrl: 'http://nas.local:3000',
        token: 'jwt',
      })

      await client.completeDownload(99, { completed: true, bytesTransferred: 1_000_000 })

      expect(calls[0]!.url).toBe('http://nas.local:3000/api/downloads/99')
      expect(calls[0]!.init.method).toBe('PATCH')
      const body = JSON.parse(calls[0]!.init.body as string)
      expect(body).toEqual({ completed: true, bytes_transferred: 1_000_000 })
    })
  })

  describe('downloadFile (Range)', () => {
    it('issues a GET with Range: bytes=0- by default', async () => {
      const { fetch, calls } = makeFetchRecorder(() =>
        emptyResponse(206, { 'content-range': 'bytes 0-9/100', 'content-length': '10' }),
      )
      const client = createNasClient({
        fetch,
        baseUrl: 'http://nas.local:3000',
        token: 'jwt',
      })

      await client.downloadFile(7, '/tmp/dest.bin', () => {})

      expect(headerOf(calls[0]!, 'range')).toBe('bytes=0-')
      expect(calls[0]!.url).toBe('http://nas.local:3000/api/files/7')
    })

    it('invokes the onProgress callback with bytes received', async () => {
      // Build a real Response whose body streams two chunks. The
      // nas-client's `downloadFile` just drains the body and reports
      // bytes per chunk — the resumable / disk-writing transport is
      // exercised in `lib/download/range-client.test.ts`.
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]))
          controller.enqueue(new Uint8Array([4, 5, 6]))
          controller.close()
        },
      })
      const response = new Response(stream, {
        status: 206,
        headers: { 'content-range': 'bytes 0-5/6' },
      })
      const { fetch } = makeFetchRecorder(() => response)
      const client = createNasClient({
        fetch,
        baseUrl: 'http://nas.local:3000',
        token: 'jwt',
      })

      const progressValues: number[] = []
      await client.downloadFile(7, '/tmp/dest.bin', (bytes) => {
        progressValues.push(bytes)
      })

      // Two chunks (3 + 3) should produce two progress callbacks;
      // the total must reflect the full file size.
      expect(progressValues.length).toBeGreaterThanOrEqual(2)
      expect(progressValues[progressValues.length - 1]).toBe(6)
    })
  })

  describe('createNasClient options', () => {
    it('resolves ALEJANDRIA_NAS_URL from the environment when baseUrl is omitted', async () => {
      process.env['ALEJANDRIA_NAS_URL'] = 'http://nas.env:3000'
      const { fetch, calls } = makeFetchRecorder(() =>
        jsonResponse({ mdns_name: 'x', port: 3000 }),
      )

      const client = createNasClient({ fetch })
      await client.getDiscoveryInfo()

      expect(calls[0]!.url.startsWith('http://nas.env:3000/')).toBe(true)
    })

    it('strips a trailing slash from baseUrl', async () => {
      const { fetch, calls } = makeFetchRecorder(() =>
        jsonResponse({ mdns_name: 'x', port: 3000 }),
      )

      const client = createNasClient({
        fetch,
        baseUrl: 'http://nas.local:3000/',
      } satisfies NasClientOptions)
      await client.getDiscoveryInfo()

      expect(calls[0]!.url).toBe('http://nas.local:3000/api/discovery/info')
    })
  })
})
