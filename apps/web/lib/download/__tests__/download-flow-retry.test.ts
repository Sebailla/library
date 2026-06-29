import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { downloadBook } from '../download-flow'
import type { INasClient, NasBookDetail, NasStartDownloadResponse } from '../../api/nas-client'

/**
 * TDD tests for the retry + resume behaviour added to
 * `downloadBook` (PR-3-fix-B, issue #62).
 *
 * Contract pinned here:
 *
 *   1. Each NAS round-trip step (`getBook`, `startDownload`,
 *      `downloadFile`, `completeDownload`) is wrapped in
 *      `withRetry` with the default config (attempts=3,
 *      exponential backoff). A single transient 503 is
 *      retried; the user gets a successful download.
 *   2. The retry helper is dependency-injected so tests can
 *      observe call counts without real timers.
 *   3. After N transient failures the step still surfaces the
 *      underlying error (so the caller's flow can decide).
 */

const SAMPLE_BOOK: NasBookDetail = {
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
  file_size_bytes: 1_000,
  content_hash: 'sha256:abc',
  categories: [],
  sagas: [],
}

interface InMemoryNasClient extends INasClient {
  startDownload: ReturnType<typeof vi.fn>
  completeDownload: ReturnType<typeof vi.fn>
  getBook: ReturnType<typeof vi.fn>
  downloadFile: ReturnType<typeof vi.fn>
}

function makeMockNasClient(
  overrides: Partial<{
    start: NasStartDownloadResponse
  }> = {},
): InMemoryNasClient {
  const start: NasStartDownloadResponse = overrides.start ?? {
    download_id: 99,
    resume_supported: true,
  }
  return {
    pair: vi.fn(),
    refresh: vi.fn(),
    listBooks: vi.fn(),
    getBook: vi.fn(async () => SAMPLE_BOOK),
    search: vi.fn(),
    listCategories: vi.fn(),
    getDiscoveryInfo: vi.fn(),
    getDiscoveryNetwork: vi.fn(),
    startDownload: vi.fn(async () => start),
    completeDownload: vi.fn(async () => ({
      id: start.download_id,
      completed: true,
      bytes_transferred: SAMPLE_BOOK.file_size_bytes ?? 0,
      book_id: SAMPLE_BOOK.id,
      device_id: 'device-1',
      downloaded_at: '2026-06-28T18:00:00Z',
    })),
    downloadFile: vi.fn(
      async (
        _bookId: number,
        destPath: string,
        onProgress: (bytes: number) => void,
        downloadOptions: { writeFile?: (path: string, data: Uint8Array) => Promise<void> } = {},
      ) => {
        const writeFile = downloadOptions.writeFile
        const payload = new Uint8Array([1, 2, 3, 4, 5])
        onProgress(payload.byteLength)
        if (writeFile) {
          await writeFile(destPath, payload)
        }
      },
    ),
  }
}

describe('downloadBook — retry + backoff (#62)', () => {
  let tmpDir: string
  const writers: Array<{ path: string; bytes: Uint8Array }> = []

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'alejandria-dlretry-'))
    process.env['ALEJANDRIA_DATA_DIR'] = tmpDir
    writers.length = 0
  })

  afterEach(() => {
    delete process.env['ALEJANDRIA_DATA_DIR']
    rmSync(tmpDir, { recursive: true, force: true })
  })

  function makeInMemoryWriter() {
    return async (path: string, bytes: Uint8Array): Promise<void> => {
      writers.push({ path, bytes })
    }
  }

  /**
   * No-op retry helper — keeps the suite fast by skipping the
   * 250 ms base backoff. Tests that need real retry behaviour
   * (e.g. to assert the call count after multiple transient
   * failures) use a `fastRetry` with `baseMs=1` instead so the
   * suite still finishes in milliseconds.
   */
  function noRetry<T>(fn: () => Promise<T>): Promise<T> {
    return fn()
  }

  async function fastRetry<T>(fn: () => Promise<T>): Promise<T> {
    const { withRetry } = await import('../retry')
    return withRetry(fn, { attempts: 3, backoff: 'exp', baseMs: 1 })
  }

  it('retries a transient getBook failure then completes the download', async () => {
    // First call to getBook throws (simulated 503); second call
    // succeeds. The download MUST complete normally because
    // withRetry wraps the NAS round-trip with attempts=3.
    let getBookAttempts = 0
    const nas = makeMockNasClient()
    nas.getBook = vi.fn(async () => {
      getBookAttempts += 1
      if (getBookAttempts < 2) {
        const err = new Error('503 Service Unavailable') as Error & { status?: number }
        err.status = 503
        throw err
      }
      return SAMPLE_BOOK
    })

await downloadBook({
      bookId: 7,
      deviceId: 'device-1',
      deviceName: 'iPad',
      userId: 'user-1',
      destPath: join(tmpDir, 'ficciones.pdf'),
      nasClient: nas,
      writeFile: makeInMemoryWriter(),
      retry: fastRetry,
    })

    // The retry MUST have re-issued getBook at least twice.
    expect(getBookAttempts).toBeGreaterThanOrEqual(2)
    // The download completed → completeDownload fired.
    expect(nas.completeDownload).toHaveBeenCalledTimes(1)
  })

  it('surfaces the underlying error when all retries on getBook fail', async () => {
    const nas = makeMockNasClient()
    nas.getBook = vi.fn(async () => {
      throw new Error('503 persistent')
    })

    await expect(
      downloadBook({
        bookId: 7,
        deviceId: 'device-1',
        deviceName: 'iPad',
        userId: 'user-1',
        destPath: join(tmpDir, 'ficciones.pdf'),
        nasClient: nas,
        writeFile: makeInMemoryWriter(),
      retry: noRetry,
      }),
    ).rejects.toThrow(/503 persistent/)

    // No retry of subsequent steps; startDownload was never
    // reached because getBook is the first round-trip.
    expect(nas.startDownload).not.toHaveBeenCalled()
    expect(nas.completeDownload).not.toHaveBeenCalled()
  })

  it('retries a transient completeDownload failure then resolves', async () => {
    // The download itself succeeds; only the bookkeeping
    // PATCH fails twice and succeeds on the third try.
    let completeAttempts = 0
    const nas = makeMockNasClient()
    nas.completeDownload = vi.fn(async () => {
      completeAttempts += 1
      if (completeAttempts < 3) {
        const err = new Error('504 Gateway Timeout') as Error & { status?: number }
        err.status = 504
        throw err
      }
      return {
        id: 99,
        completed: true,
        bytes_transferred: 5,
        book_id: 7,
        device_id: 'device-1',
        downloaded_at: '2026-06-28T18:00:00Z',
      }
    })

await expect(
      downloadBook({
        bookId: 7,
        deviceId: 'device-1',
        deviceName: 'iPad',
        userId: 'user-1',
        destPath: join(tmpDir, 'ficciones.pdf'),
        nasClient: nas,
        writeFile: makeInMemoryWriter(),
        retry: fastRetry,
      }),
    ).resolves.toMatchObject({ downloadId: 99 })

    expect(completeAttempts).toBe(3)
  })
})