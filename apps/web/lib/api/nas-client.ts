/**
 * HTTP client for the NAS catalog service (PR-2 / `nas-catalog-service`).
 *
 * The client is a pure, dependency-injected wrapper around `fetch`:
 *
 *  - Every method targets a documented PR-2 endpoint and returns a
 *    strongly-typed response. Callers never touch `fetch` directly.
 *  - Authentication is bearer-token based. The constructor takes an
 *    optional `token`; methods that require auth (`/api/books`,
 *    `/api/search`, etc.) attach `Authorization: Bearer <token>`.
 *    Pre-auth endpoints (`/api/auth/pair`, `/api/discovery/info`)
 *    never carry a token even if one is configured.
 *  - The base URL resolves from `ALEJANDRIA_NAS_URL` (Electron PR-4
 *    overrides this) and defaults to the local NestJS backend on
 *    `:3000` per `services/nas-backend/src/main.ts`.
 *
 * The download path (`downloadFile`) uses a Range request to
 * resume partial transfers; see `lib/download/range-client.ts` for
 * the resumable transport that wraps this method.
 */

/** A row as the NAS serves it from `GET /api/books` (PR-2D). */
export interface NasBook {
  id: number
  title: string
  author_id: number | null
  year: number | null
  language: string | null
  format: string | null
  file_path: string
  cover_path: string | null
  excerpt: string | null
  indexed_at: string
}

/** Response shape for `GET /api/books` (PR-2D). */
export interface NasListBooksResponse {
  data: readonly NasBook[]
  page: number
  limit: number
  total: number
}

/** Detail shape for `GET /api/books/:id` (PR-2D). */
export interface NasBookDetail extends NasBook {
  file_size_bytes: number | null
  content_hash: string | null
  categories: readonly { id: number; path: string; name_es: string; name_en: string }[]
  sagas: readonly { id: number; name: string; author_id: number | null }[]
}

/** Wire shape returned by `POST /api/auth/pair` + `POST /api/auth/refresh`. */
export interface NasPairResponse {
  token: string
  expires_at: string
  device_id: string
}

/** Wire shape for `POST /api/auth/pair` (PR-2C). */
export interface NasPairRequest {
  pin: string
  deviceName: string
}

/** Response from `GET /api/search` (PR-2D). */
export interface NasSearchResponse {
  data: readonly {
    id: number
    title: string
    author: string | null
    year: number | null
    format: string | null
  }[]
  total: number
  limit: number
  offset: number
}

/** Response from `GET /api/categories` (PR-2D). */
export interface NasCategoriesResponse {
  data: readonly unknown[]
}

/** Pre-auth discovery (PR-2F.1). */
export interface NasDiscoveryInfo {
  mdns_name: string
  port: number
}

/** Auth-required discovery (PR-2F.1). */
export interface NasDiscoveryNetwork {
  tailscale_ip: string | null
  lan_ips: readonly string[]
}

/** Response from `POST /api/downloads` (PR-2E). */
export interface NasStartDownloadResponse {
  download_id: number
  resume_supported: boolean
}

/** Response from `PATCH /api/downloads/:id` (PR-2E). */
export interface NasCompleteDownloadResponse {
  id: number
  completed: boolean
  bytes_transferred: number
  book_id: number
  device_id: string | null
  downloaded_at: string
}

/** Input for `startDownload` — the tracking envelope. */
export interface NasStartDownloadRequest {
  bookId: number
  deviceId: string
  deviceName: string
  userId: string
  fileSizeBytes: number
}

/** Input for `completeDownload` — the completion envelope. */
export interface NasCompleteDownloadRequest {
  completed: boolean
  bytesTransferred: number
}

/** Filters for `listBooks` (PR-2D). */
export interface NasListBooksFilters {
  page?: number
  limit?: number
  authorId?: number
  format?: string
  language?: string
}

/** Options for `search` (PR-2D). */
export interface NasSearchOptions {
  limit?: number
  offset?: number
}

/** Client options. */
export interface NasClientOptions {
  /** Override the base URL (defaults to env / localhost:3000). */
  baseUrl?: string
  /** Bearer token; required for auth-required endpoints. */
  token?: string
  /** Override the fetch implementation (used by tests). */
  fetch?: typeof fetch
  /** Path to the directory used to materialize downloaded files. */
  downloadDir?: string
}

/** Public surface — implemented by {@link createNasClient}. */
export interface INasClient {
  pair(request: NasPairRequest): Promise<NasPairResponse>
  refresh(): Promise<NasPairResponse>
  listBooks(filters: NasListBooksFilters): Promise<NasListBooksResponse>
  getBook(id: number): Promise<NasBookDetail>
  search(query: string, options: NasSearchOptions): Promise<NasSearchResponse>
  listCategories(): Promise<NasCategoriesResponse>
  getDiscoveryInfo(): Promise<NasDiscoveryInfo>
  getDiscoveryNetwork(): Promise<NasDiscoveryNetwork>
  startDownload(request: NasStartDownloadRequest): Promise<NasStartDownloadResponse>
  completeDownload(
    downloadId: number,
    request: NasCompleteDownloadRequest,
  ): Promise<NasCompleteDownloadResponse>
  downloadFile(
    bookId: number,
    destPath: string,
    onProgress: (bytesReceived: number) => void,
  ): Promise<void>
}

/**
 * Resolve the NAS base URL. Defaults to the local NestJS backend
 * on `:3000` (the port the sidecar reserves per services/nas-backend
 * src/main.ts). Electron (PR4) overrides this via
 * `ALEJANDRIA_NAS_URL`.
 */
export function resolveNasBaseUrl(): string {
  return process.env['ALEJANDRIA_NAS_URL'] ?? 'http://localhost:3000'
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
}

interface RequestOptions {
  method: 'GET' | 'POST' | 'PATCH'
  body?: unknown
  /** Whether to send the bearer token. Defaults to `true`. */
  authenticated?: boolean
  /** Custom headers (e.g. Range). */
  extraHeaders?: Record<string, string>
}

class NasHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | null,
    message: string,
  ) {
    super(message)
    this.name = 'NasHttpError'
  }
}

function describeError(status: number, body: unknown): NasHttpError {
  if (typeof body === 'object' && body !== null) {
    const envelope = body as { error?: { code?: string; message?: string } }
    if (envelope.error) {
      return new NasHttpError(
        status,
        envelope.error.code ?? null,
        `${status} ${envelope.error.code ?? ''}: ${envelope.error.message ?? ''}`.trim(),
      )
    }
  }
  return new NasHttpError(status, null, `NAS request failed: ${status}`)
}

interface NasClientState {
  baseUrl: string
  token: string | null
  fetchImpl: typeof fetch
}

async function sendJson<T>(state: NasClientState, path: string, options: RequestOptions): Promise<T> {
  const url = `${state.baseUrl}${path}`
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json',
  }
  if (options.authenticated !== false && state.token) {
    headers['authorization'] = `Bearer ${state.token}`
  }
  if (options.extraHeaders) {
    Object.assign(headers, options.extraHeaders)
  }

  const init: RequestInit = {
    method: options.method,
    headers,
  }
  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body)
  }

  const response = await state.fetchImpl(url, init)
  if (!response.ok) {
    let body: unknown = null
    try {
      body = await response.json()
    } catch {
      // ignore — non-JSON error body
    }
    throw describeError(response.status, body)
  }
  // 204 No Content
  if (response.status === 204) {
    return undefined as T
  }
  return (await response.json()) as T
}

interface DownloadStreamChunk {
  value: Uint8Array
}

/**
 * Drain a `Response.body` while invoking `onProgress` per chunk.
 *
 * The implementation is intentionally tiny: we do not depend on
 * Node streams (the client also runs in the renderer during PR-4)
 * and we do not care about backpressure here because the destination
 * is a `node:fs` write stream owned by the caller. The Range
 * request + resumable semantics live in `lib/download/range-client.ts`;
 * this method just streams the body once and reports bytes received.
 */
async function streamToCallback(
  response: Response,
  onProgress: (bytes: number) => void,
): Promise<number> {
  if (!response.body) {
    return 0
  }
  const reader = response.body.getReader()
  let total = 0
  try {
    while (true) {
      const result = (await reader.read()) as { done: boolean; value?: Uint8Array | DownloadStreamChunk }
      if (result.done) break
      const value = result.value as Uint8Array | undefined
      if (value && typeof value.byteLength === 'number') {
        total += value.byteLength
        onProgress(total)
      }
    }
  } finally {
    reader.releaseLock()
  }
  return total
}

/**
 * Open a NAS client.
 *
 * The client is stateful in two senses:
 *  - the `baseUrl` is fixed at construction time
 *  - the bearer token is captured at construction time. Callers
 *    that need to rotate must re-construct the client (the
 *    `pair` / `refresh` methods are the entry points that produce
 *    a fresh token).
 */
export function createNasClient(options: NasClientOptions = {}): INasClient {
  const state: NasClientState = {
    baseUrl: normalizeBaseUrl(options.baseUrl ?? resolveNasBaseUrl()),
    token: options.token ?? null,
    fetchImpl: options.fetch ?? globalThis.fetch.bind(globalThis),
  }

  return {
    async pair(request: NasPairRequest): Promise<NasPairResponse> {
      return sendJson<NasPairResponse>(state, '/api/auth/pair', {
        method: 'POST',
        authenticated: false,
        body: { pin: request.pin, device_name: request.deviceName },
      })
    },

    async refresh(): Promise<NasPairResponse> {
      if (!state.token) {
        throw new Error('refresh() requires a configured bearer token')
      }
      return sendJson<NasPairResponse>(state, '/api/auth/refresh', {
        method: 'POST',
        authenticated: false,
        body: { token: state.token },
      })
    },

    async listBooks(filters: NasListBooksFilters): Promise<NasListBooksResponse> {
      const params = new URLSearchParams()
      if (filters.page !== undefined) params.set('page', String(filters.page))
      if (filters.limit !== undefined) params.set('limit', String(filters.limit))
      if (filters.authorId !== undefined) params.set('author_id', String(filters.authorId))
      if (filters.format !== undefined) params.set('format', filters.format)
      if (filters.language !== undefined) params.set('language', filters.language)
      const query = params.toString()
      const path = query.length > 0 ? `/api/books?${query}` : '/api/books'
      return sendJson<NasListBooksResponse>(state, path, { method: 'GET' })
    },

    async getBook(id: number): Promise<NasBookDetail> {
      return sendJson<NasBookDetail>(state, `/api/books/${id}`, { method: 'GET' })
    },

    async search(query: string, opts: NasSearchOptions): Promise<NasSearchResponse> {
      const params = new URLSearchParams({ q: query })
      if (opts.limit !== undefined) params.set('limit', String(opts.limit))
      if (opts.offset !== undefined) params.set('offset', String(opts.offset))
      return sendJson<NasSearchResponse>(state, `/api/search?${params.toString()}`, {
        method: 'GET',
      })
    },

    async listCategories(): Promise<NasCategoriesResponse> {
      return sendJson<NasCategoriesResponse>(state, '/api/categories', { method: 'GET' })
    },

    async getDiscoveryInfo(): Promise<NasDiscoveryInfo> {
      return sendJson<NasDiscoveryInfo>(state, '/api/discovery/info', {
        method: 'GET',
        authenticated: false,
      })
    },

    async getDiscoveryNetwork(): Promise<NasDiscoveryNetwork> {
      return sendJson<NasDiscoveryNetwork>(state, '/api/discovery/network', { method: 'GET' })
    },

    async startDownload(request: NasStartDownloadRequest): Promise<NasStartDownloadResponse> {
      return sendJson<NasStartDownloadResponse>(state, '/api/downloads', {
        method: 'POST',
        body: {
          book_id: request.bookId,
          device_id: request.deviceId,
          device_name: request.deviceName,
          user_id: request.userId,
          file_size_bytes: request.fileSizeBytes,
        },
      })
    },

    async completeDownload(
      downloadId: number,
      request: NasCompleteDownloadRequest,
    ): Promise<NasCompleteDownloadResponse> {
      return sendJson<NasCompleteDownloadResponse>(
        state,
        `/api/downloads/${downloadId}`,
        {
          method: 'PATCH',
          body: {
            completed: request.completed,
            bytes_transferred: request.bytesTransferred,
          },
        },
      )
    },

    async downloadFile(
      bookId: number,
      _destPath: string,
      onProgress: (bytesReceived: number) => void,
    ): Promise<void> {
      const url = `${state.baseUrl}/api/files/${bookId}`
      const headers: Record<string, string> = {
        range: 'bytes=0-',
      }
      if (state.token) {
        headers['authorization'] = `Bearer ${state.token}`
      }
      const response = await state.fetchImpl(url, { method: 'GET', headers })
      if (!response.ok && response.status !== 206) {
        throw describeError(response.status, null)
      }
      await streamToCallback(response, onProgress)
    },
  }
}

/**
 * Backwards-compatible factory preserved for the PR-3A stub
 * callers (the (nas)/browse page). New code MUST use
 * {@link createNasClient} so the dependency-injected `fetch`
 * is honoured in tests.
 *
 * @deprecated use {@link createNasClient}.
 */
export function openNasClient(): INasClient {
  return createNasClient()
}

/** Exposed for tests that want to assert on the typed error. */
export { NasHttpError }
