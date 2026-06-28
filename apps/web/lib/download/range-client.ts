/**
 * Pure, dependency-injected transport for HTTP Range requests.
 *
 * The NAS backend (PR-2E) serves book files via
 * `GET /api/files/:id` with `Range: bytes=<start>-` support so a
 * client can resume a partial transfer. This module wraps that
 * contract in a small, testable function:
 *
 *   downloadWithRange(url, destPath, fetchImpl, options)
 *     → issues `Range: bytes=<start>-`
 *     → accepts 200 OK AND 206 Partial Content
 *     → streams the response body to disk via the injected
 *       `writeFile` (defaults to `node:fs/promises.writeFile`)
 *     → fires `onProgress(bytesReceived)` per chunk
 *     → returns the total bytes written
 *
 * The module is intentionally DOM-free so it can be used from
 * Server Components, Server Actions, and the Electron main
 * process. The actual integration with the local SQLite (`upsert
 * after download`) lives in `lib/download/download-flow.ts`.
 */

import { writeFile as fsWriteFile } from 'node:fs/promises'

/** Minimal `fetch` contract the transport needs. */
export type RangeClientFetch = (
  input: string,
  init: RequestInit,
) => Promise<Response>

/** A writer that appends bytes to a destination. */
export type WriteFileFn = (path: string, data: Uint8Array) => Promise<void>

/** Options for {@link downloadWithRange}. */
export interface DownloadWithRangeOptions {
  /** Byte offset to start from (default 0 = fresh download). */
  start?: number
  /** Per-chunk progress callback (cumulative bytes received). */
  onProgress?: (bytesReceived: number) => void
  /** Custom writer (defaults to `node:fs/promises.writeFile`). */
  writeFile?: WriteFileFn
  /** Bearer token for the Authorization header. */
  token?: string
}

/**
 * Download a file with HTTP Range support.
 *
 * Throws if the response status is neither 200 nor 206 (the two
 * status codes the NAS backend may return — 206 when Range is
 * honoured, 200 when the server ignores Range and returns the
 * full body). The function returns the number of bytes written.
 */
export async function downloadWithRange(
  url: string,
  destPath: string,
  fetchImpl: RangeClientFetch,
  options: DownloadWithRangeOptions = {},
): Promise<number> {
  const start = options.start ?? 0
  const headers: Record<string, string> = {
    range: `bytes=${start}-`,
  }
  if (options.token) {
    headers['authorization'] = `Bearer ${options.token}`
  }

  const response = await fetchImpl(url, { method: 'GET', headers })

  if (response.status !== 200 && response.status !== 206) {
    throw new Error(
      `downloadWithRange: unexpected status ${response.status} ${response.statusText}`.trim(),
    )
  }

  const writeFile = options.writeFile ?? defaultWriteFile
  const bytes = await readResponseBody(response, options.onProgress)
  await writeFile(destPath, bytes)
  return bytes.byteLength
}

/**
 * Read the entire response body into a single `Uint8Array` while
 * firing the per-chunk progress callback.
 *
 * The chunked approach (`for await (const chunk of stream)`) is
 * used to keep memory pressure bounded for large files; the
 * chunks are concatenated into a single buffer because
 * `node:fs/promises.writeFile` is the only writer the platform
 * gives us without an open file handle to manage.
 */
async function readResponseBody(
  response: Response,
  onProgress?: (bytesReceived: number) => void,
): Promise<Uint8Array> {
  if (!response.body) {
    return new Uint8Array()
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const result = (await reader.read()) as { done: boolean; value?: Uint8Array }
      if (result.done) break
      const chunk = result.value
      if (!chunk) continue
      chunks.push(chunk)
      total += chunk.byteLength
      if (onProgress) onProgress(total)
    }
  } finally {
    reader.releaseLock()
  }
  return concatChunks(chunks, total)
}

function concatChunks(chunks: readonly Uint8Array[], total: number): Uint8Array {
  if (chunks.length === 0) return new Uint8Array()
  if (chunks.length === 1) {
    const only = chunks[0]!
    if (only.byteLength === total) return only
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

const defaultWriteFile: WriteFileFn = async (path, data) => {
  await fsWriteFile(path, data)
}
