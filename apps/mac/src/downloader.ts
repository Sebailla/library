/**
 * Real NAS downloader for the `@alejandria/mac` Electron shell
 * (PR-N8, issue #94).
 *
 * Wires the mac IPC `aleja:download` channel to the NAS via
 * native `fetch`. No third-party HTTP client — Node ≥ 20 ships
 * `fetch` and `Headers`, which is all this module needs.
 *
 * Contract (the four endpoints the NAS exposes):
 *
 *   GET  /api/books?page=N&limit=M           → listBooks()
 *   POST /api/downloads                      → startDownload()
 *   GET  /api/files/:id                      → downloadFile()
 *   PATCH /api/downloads/:id                 → completeDownload()
 *
 * The downloader bridges them into a single
 * {@link NasDownloader.download bookId → file} sequence so the
 * renderer's `window.alejandria.download(bookId)` call materialises
 * the file on disk without it having to know about REST pagination
 * or download tracking envelopes.
 *
 * Implementation choices:
 *
 *   - All four endpoints are wrapped in a single `NasDownloader`
 *     class so the IPC layer can keep its dependency on a single
 *     object (same shape as before the PR-4C stub).
 *   - Error envelopes (`{ error: { code, message } }`) are mapped to
 *     `NasHttpError` so the IPC layer can branch on `code` without
 *     parsing the message text.
 *   - The `fetch` seam defaults to `globalThis.fetch` but can be
 *     overridden per call (tests inject a per-test wrapper).
 *
 * Strict TDD: the public surface (`listBooks`, `download`,
 * `createNasDownloader`, `NasDownloader`) is mirrored in the
 * `__tests__/downloader.integration.test.ts` suite.
 */

import { writeFile } from 'node:fs/promises'

/** A row as the NAS serves it from `GET /api/books` (PR-2D). */
export interface NasBook {
  id: number
  title: string
  author_id?: number | null
  year?: number | null
  format: string | null
  file_path: string
}

/** Response from `GET /api/books`. */
export interface NasListBooksResponse {
  data: readonly NasBook[]
  page: number
  limit: number
  total: number
}

/** Filters for `listBooks`. */
export interface NasListBooksFilters {
  page?: number
  limit?: number
  author_id?: number
  format?: string
}

/** Response from `POST /api/downloads`. */
export interface NasStartDownloadResponse {
  download_id: number
  resume_supported: boolean
}

/** Response from `PATCH /api/downloads/:id`. */
export interface NasCompleteDownloadResponse {
  id: number
  completed: boolean
  bytes_transferred: number
  book_id: number
  device_id: string | null
  downloaded_at: string
}

/** Identity fields required to start a download. */
export interface NasDownloaderIdentity {
  deviceId?: string
  deviceName?: string
  userId?: string
}

/** Public result of {@link NasDownloader.download}. */
export interface NasDownloadResult {
  ok: true
  bookId: number
  bytesTransferred: number
  downloadId: number
  transport: 'nas'
}

/** Options for {@link createNasDownloader}. */
export interface NasDownloaderOptions {
  /** Override the base URL (defaults to `ALEJANDRIA_NAS_URL`/`http://localhost:3000`). */
  baseUrl?: string
  /** Bearer token for authenticated endpoints. */
  token?: string
  /** Identity fields posted to `POST /api/downloads` (PR-2E). */
  deviceId?: string
  deviceName?: string
  userId?: string
  /** Override the fetch implementation (tests inject a fake). */
  fetch?: typeof fetch
}

/** Default base URL — matches `services/nas-backend/src/main.ts`. */
export function resolveNasBaseUrl(): string {
  return process.env['ALEJANDRIA_NAS_URL'] ?? 'http://localhost:3000'
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
}

/**
 * Thrown by the downloader when the NAS returns a non-OK response.
 * The `code` mirrors the NAS error envelope's `code` so the IPC
 * layer can branch on it without string parsing the message.
 */
export class NasHttpError extends Error {
  readonly status: number
  readonly code: string | null
  constructor(status: number, code: string | null, message: string) {
    super(message)
    this.name = 'NasHttpError'
    this.status = status
    this.code = code
  }
}

interface JsonRequestInit {
  method: 'GET' | 'POST' | 'PATCH'
  body?: unknown
}

async function sendJson<T>(
  baseUrl: string,
  token: string | null,
  path: string,
  init: JsonRequestInit,
  fetchImpl: typeof fetch,
): Promise<T> {
  const url = `${baseUrl}${path}`
  const headers: Record<string, string> = {
    accept: 'application/json',
  }
  if (init.body !== undefined) {
    headers['content-type'] = 'application/json'
  }
  if (token !== null) {
    headers['authorization'] = `Bearer ${token}`
  }
  const reqInit: RequestInit = { method: init.method, headers }
  if (init.body !== undefined) {
    reqInit.body = JSON.stringify(init.body)
  }
  const response = await fetchImpl(url, reqInit)
  if (!response.ok) {
    let body: unknown = null
    try {
      body = await response.json()
    } catch {
      /* non-JSON error body */
    }
    throw describeNasError(response.status, body, `NAS request failed: ${response.status} ${path}`)
  }
  // 204 No Content (not currently used, but kept for parity with the web client).
  if (response.status === 204) {
    return undefined as T
  }
  return (await response.json()) as T
}

function describeNasError(status: number, body: unknown, fallback: string): NasHttpError {
  if (typeof body === 'object' && body !== null) {
    const envelope = body as { error?: { code?: string; message?: string } }
    if (envelope.error) {
      return new NasHttpError(
        status,
        envelope.error.code ?? null,
        `${status} ${envelope.error.code ?? ''}: ${envelope.error.message ?? ''}`.trim() || fallback,
      )
    }
  }
  return new NasHttpError(status, null, fallback)
}

/**
 * Public client used by the IPC layer. Created by
 * {@link createNasDownloader}.
 */
export class NasDownloader {
  readonly #baseUrl: string
  readonly #token: string | null
  readonly #identity: Required<Pick<NasDownloaderIdentity, 'deviceId' | 'deviceName' | 'userId'>>
  readonly #fetchImpl: typeof fetch

  constructor(options: NasDownloaderOptions = {}) {
    this.#baseUrl = normalizeBaseUrl(options.baseUrl ?? resolveNasBaseUrl())
    this.#token = options.token ?? null
    this.#identity = {
      deviceId: options.deviceId ?? 'mac-electron',
      deviceName: options.deviceName ?? 'Alejandría for macOS',
      userId: options.userId ?? 'mac',
    }
    this.#fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis)
  }

  /** `GET /api/books`. */
  async listBooks(filters: NasListBooksFilters): Promise<NasListBooksResponse> {
    const params = new URLSearchParams()
    if (filters.page !== undefined) params.set('page', String(filters.page))
    if (filters.limit !== undefined) params.set('limit', String(filters.limit))
    if (filters.author_id !== undefined) params.set('author_id', String(filters.author_id))
    if (filters.format !== undefined) params.set('format', filters.format)
    const query = params.toString()
    const path = query.length > 0 ? `/api/books?${query}` : '/api/books'
    return sendJson<NasListBooksResponse>(this.#baseUrl, this.#token, path, { method: 'GET' }, this.#fetchImpl)
  }

  /** `POST /api/downloads` — begin a download tracking row. */
  async startDownload(bookId: number, fileSizeBytes: number | null): Promise<NasStartDownloadResponse> {
    return sendJson<NasStartDownloadResponse>(
      this.#baseUrl,
      this.#token,
      '/api/downloads',
      {
        method: 'POST',
        body: {
          book_id: bookId,
          device_id: this.#identity.deviceId,
          device_name: this.#identity.deviceName,
          user_id: this.#identity.userId,
          file_size_bytes: fileSizeBytes,
        },
      },
      this.#fetchImpl,
    )
  }

  /** `PATCH /api/downloads/:id` — close the tracking row. */
  async completeDownload(
    downloadId: number,
    payload: { completed: boolean; bytesTransferred: number },
  ): Promise<NasCompleteDownloadResponse> {
    return sendJson<NasCompleteDownloadResponse>(
      this.#baseUrl,
      this.#token,
      `/api/downloads/${downloadId}`,
      {
        method: 'PATCH',
        body: {
          completed: payload.completed,
          bytes_transferred: payload.bytesTransferred,
        },
      },
      this.#fetchImpl,
    )
  }

  /**
   * End-to-end: start the download, fetch the bytes, write them to
   * `destPath`, and complete the tracking row. Returns the
   * completion envelope so the IPC layer can surface transfer
   * stats to the renderer.
   */
  async download(bookId: number, destPath: string): Promise<NasDownloadResult> {
    const start = await this.startDownload(bookId, null)
    const headers: Record<string, string> = {}
    if (this.#token !== null) {
      headers['authorization'] = `Bearer ${this.#token}`
    }
    const response = await this.#fetchImpl(`${this.#baseUrl}/api/files/${bookId}`, {
      method: 'GET',
      headers,
    })
    if (!response.ok && response.status !== 206) {
      throw new NasHttpError(
        response.status,
        null,
        `NAS file download failed: ${response.status} /api/files/${bookId}`,
      )
    }
    const arrayBuffer = await response.arrayBuffer()
    const bytes = Buffer.from(arrayBuffer)
    await writeFile(destPath, bytes)
    const bytesTransferred = bytes.byteLength
    await this.completeDownload(start.download_id, { completed: true, bytesTransferred })
    return {
      ok: true,
      bookId,
      bytesTransferred,
      downloadId: start.download_id,
      transport: 'nas',
    }
  }
}

/**
 * Build a {@link NasDownloader} using the supplied options. The
 * factory indirection keeps parity with the web
 * `apps/web/lib/api/nas-client.ts` API surface (`createNasClient`) so
 * the IPC layer can depend on a single `downloader.download(bookId)`
 * call regardless of where the underlying client came from.
 */
export function createNasDownloader(options: NasDownloaderOptions = {}): NasDownloader {
  return new NasDownloader(options)
}
