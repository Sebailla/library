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

import { logError } from '@/lib/log'

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
  /**
   * Stream a book file to disk via `GET /api/files/:id` with
   * `Range: bytes=0-`. The caller supplies the byte writer so
   * the transport stays dependency-injected (tests use an
   * in-memory writer; production wires `node:fs/promises`).
   */
  downloadFile(
    bookId: number,
    destPath: string,
    onProgress: (bytesReceived: number) => void,
    options?: DownloadFileOptions,
  ): Promise<void>
}

/**
 * Default hard cap on downloaded bytes per `downloadFile` call
 * (PR-3-fix-B, issue #63). The cap is enforced per-call so a
 * single misconfigured NAS endpoint cannot OOM the Server Action
 * via a streaming 5 GB response. Operators can lower the cap per
 * deployment by setting `ALEJANDRIA_MAX_DOWNLOAD_BYTES`.
 */
export const MAX_DOWNLOAD_BYTES = 1024 * 1024 * 1024

/** Options for {@link INasClient.downloadFile}. */
export interface DownloadFileOptions {
  /** Writer used to persist the body. Defaults to `node:fs/promises.writeFile`. Invoked PER chunk, not once with the full body. */
  writeFile?: (path: string, data: Uint8Array) => Promise<void>
  /** Start byte for the Range header (defaults to 0). Cumulative progress includes `start`. */
  start?: number
  /**
   * Hard cap on cumulative bytes (default `MAX_DOWNLOAD_BYTES`).
   * On overflow the helper rejects with
   * `DownloadOverflowError(code='DOWNLOAD_OVERFLOW')` and
   * deletes the partial destination file.
   */
  maxBytes?: number
  /**
   * Override the unlink seam used to delete partial files on
   * overflow. Defaults to `node:fs/promises.unlink`.
   */
  unlink?: (path: string) => Promise<void>
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
    } catch (err) {
      // Non-JSON error body — surface the parse failure but
      // continue to throw the HTTP error below (which already
      // carries the status code).
      logError('nas-client', err, { stage: 'parse-error-body', status: response.status, path })
    }
    throw describeError(response.status, body)
  }
  // 204 No Content
  if (response.status === 204) {
    return undefined as T
  }
  return (await response.json()) as T
}

/**
 * Drain a `Response.body` chunk-by-chunk, invoking the injected
 * writer PER chunk and reporting the cumulative byte count via
 * `onProgress`. PR-3-fix-B (#63, CRITICAL): the OLD implementation
 * concatenated the entire body into a single `Uint8Array` and
 * only then wrote it to disk — a 5 GB response OOMs the Server
 * Action. The streaming variant keeps memory pressure bounded
 * to one network chunk at a time and enforces a hard ceiling via
 * `maxBytes` (default `MAX_DOWNLOAD_BYTES = 1 GiB`).
 *
 * On overflow the helper rejects with a `DownloadOverflowError`
 * (code `DOWNLOAD_OVERFLOW`) and calls `unlink` (if provided) so
 * a failed retry doesn't leave stale bytes that look like
 * progress.
 */
class DownloadOverflowError extends Error {
  readonly code = 'DOWNLOAD_OVERFLOW'
  constructor(public readonly limit: number, public readonly received: number) {
    super(
      `download overflow: response body exceeded ${limit} bytes (received ${received})`,
    )
    this.name = 'DownloadOverflowError'
  }
}

async function drainToFile(
  response: Response,
  destPath: string,
  start: number,
  onProgress: (bytes: number) => void,
  writeFile: (path: string, data: Uint8Array) => Promise<void>,
  maxBytes: number,
  unlink: ((path: string) => Promise<void>) | null,
): Promise<number> {
  if (!response.body) {
    return 0
  }
  const reader = response.body.getReader()
  let cumulative = start
  try {
    while (true) {
      const result = (await reader.read()) as { done: boolean; value?: Uint8Array }
      if (result.done) break
      const value = result.value
      if (!value) continue
      cumulative += value.byteLength
      if (cumulative > maxBytes) {
        if (unlink) {
          try {
            await unlink(destPath)
          } catch (err) {
            // Best-effort cleanup. The next line throws the
            // overflow error which is what the caller cares
            // about; the unlink failure is recorded so an
            // operator can spot stale partial files.
            logError('nas-client', err, { stage: 'overflow-unlink', destPath })
          }
        }
        throw new DownloadOverflowError(maxBytes, cumulative)
      }
      await writeFile(destPath, value)
      onProgress(cumulative)
    }
  } finally {
    reader.releaseLock()
  }
  return cumulative
}

const defaultDownloadWriter = async (path: string, data: Uint8Array): Promise<void> => {
  const { writeFile } = await import('node:fs/promises')
  await writeFile(path, data)
}

const defaultUnlink = async (path: string): Promise<void> => {
  const { unlink } = await import('node:fs/promises')
  await unlink(path)
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
      destPath: string,
      onProgress: (bytesReceived: number) => void,
      options: DownloadFileOptions = {},
    ): Promise<void> {
      const start = options.start ?? 0
      const maxBytes = options.maxBytes ?? MAX_DOWNLOAD_BYTES
      const url = `${state.baseUrl}/api/files/${bookId}`
      const headers: Record<string, string> = {
        range: `bytes=${start}-`,
      }
      if (state.token) {
        headers['authorization'] = `Bearer ${state.token}`
      }
      const response = await state.fetchImpl(url, { method: 'GET', headers })
      if (!response.ok && response.status !== 206) {
        throw describeError(response.status, null)
      }
      const writeFile = options.writeFile ?? defaultDownloadWriter
      const unlink = options.unlink ?? defaultUnlink
      // PR-3-fix-B #63: stream chunks directly to disk via the
      // injected writer (one call per chunk) and enforce the
      // MAX_DOWNLOAD_BYTES cap. The pre-PR code concatenated the
      // entire body into a single Uint8Array and OOMed on any
      // response above the JS heap limit.
      await drainToFile(
        response,
        destPath,
        start,
        onProgress,
        writeFile,
        maxBytes,
        unlink,
      )
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
