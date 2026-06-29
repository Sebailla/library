import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { downloadBook } from '../download-flow'
import type { INasClient, NasBookDetail, NasStartDownloadResponse } from '../../api/nas-client'

/**
 * TDD tests for `lib/download/download-flow.ts` (PR-3C).
 *
 * `downloadBook` orchestrates the NAS-side of a book download:
 *
 *  1. Resolve the book metadata from the NAS (`getBook`)
 *  2. Notify the NAS of the transfer (`startDownload` → returns
 *     a tracking `downloadId`)
 *  3. Stream the file via the range client (`downloadFile`)
 *  4. Insert the row into the local SQLite
 *  5. Notify the NAS of completion (`completeDownload`)
 *
 * The nas-client is dependency-injected so the test asserts on
 * the exact call ordering without any HTTP. The local DB is
 * pointed at a tmpdir via the `ALEJANDRIA_DATA_DIR` env var
 * (the same hook the existing PR-3B tests use).
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
    downloadError: Error | null
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
      overrides.downloadError
        ? async () => {
            throw overrides.downloadError
          }
        : async (
            _bookId: number,
            destPath: string,
            onProgress: (bytes: number) => void,
            downloadOptions: { writeFile?: (path: string, data: Uint8Array) => Promise<void> } = {},
          ) => {
            // The real nas-client's `downloadFile` delegates the
            // body write to the injected writer AND fires
            // `onProgress(totalBytes)` after the chunk has been
            // materialised. Mirror that here so the test can assert
            // on the bytes path the production code chooses.
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

describe('download-flow (PR-3C)', () => {
  let tmpDir: string
  const writers: Array<{ path: string; bytes: Uint8Array }> = []

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'alejandria-dlflow-'))
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

  it('calls startDownload, downloadFile, completeDownload in order', async () => {
    const nas = makeMockNasClient()
    const result = await downloadBook({
      bookId: 7,
      deviceId: 'device-1',
      deviceName: 'iPad',
      userId: 'user-1',
      destPath: join(tmpDir, 'ficciones.pdf'),
      nasClient: nas,
      writeFile: makeInMemoryWriter(),
    })

    // 1. startDownload must come first and pass the device/user
    //    attribution as well as the book id and file size.
    expect(nas.startDownload).toHaveBeenCalledTimes(1)
    expect(nas.startDownload).toHaveBeenCalledWith({
      bookId: 7,
      deviceId: 'device-1',
      deviceName: 'iPad',
      userId: 'user-1',
      fileSizeBytes: 1_000,
    })

    // 2. downloadFile must run AFTER startDownload.
    expect(nas.downloadFile).toHaveBeenCalledTimes(1)
    const order = nas.startDownload.mock.invocationCallOrder[0]!
    const downloadOrder = nas.downloadFile.mock.invocationCallOrder[0]!
    expect(order).toBeLessThan(downloadOrder)

    // 3. completeDownload must run AFTER downloadFile, and must
    //    report the ACTUAL byte count — not the pre-flight expected
    //    size. The mock downloadFile writes exactly 5 bytes via the
    //    injected writer (mirroring `writeFile(destPath, new
    //    Uint8Array([1, 2, 3, 4, 5]))`). If the flow regresses to
    //    `book.file_size_bytes ?? 0`, this assertion catches it.
    expect(nas.completeDownload).toHaveBeenCalledTimes(1)
    const completeOrder = nas.completeDownload.mock.invocationCallOrder[0]!
    expect(downloadOrder).toBeLessThan(completeOrder)
    expect(nas.completeDownload).toHaveBeenCalledWith(99, {
      completed: true,
      bytesTransferred: 5,
    })

    expect(result.downloadId).toBe(99)
    expect(result.filePath).toBe(join(tmpDir, 'ficciones.pdf'))
  })

  it('persists the book into the local SQLite after the bytes are written', async () => {
    const { openLocalDb } = await import('../../db/local-db')
    const nas = makeMockNasClient()

    await downloadBook({
      bookId: 7,
      deviceId: 'device-1',
      deviceName: 'iPad',
      userId: 'user-1',
      destPath: join(tmpDir, 'ficciones.pdf'),
      nasClient: nas,
      writeFile: makeInMemoryWriter(),
    })

    const db = openLocalDb()
    try {
      const stored = db.findById('7')
      expect(stored).not.toBeNull()
      expect(stored).toMatchObject({
        id: '7',
        title: 'Ficciones',
        // The NAS API only exposes `author_id` on the detail
        // payload. The flow materialises a placeholder so the
        // local SQLite row is well-formed; a follow-up PR joins
        // against `/api/authors/:id` to fetch the display name.
        author: 'author:1',
        filePath: join(tmpDir, 'ficciones.pdf'),
        format: 'pdf',
        contentHash: 'sha256:abc',
        excerpt: '',
      })
    } finally {
      db.close()
    }
  })

  it('does NOT call completeDownload when the byte transfer fails', async () => {
    const nas = makeMockNasClient({
      downloadError: new Error('network down'),
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
      }),
    ).rejects.toThrow(/network down/)

    expect(nas.startDownload).toHaveBeenCalledTimes(1)
    expect(nas.completeDownload).not.toHaveBeenCalled()
  })

  it('passes the destination path through to the writer', async () => {
    const nas = makeMockNasClient()

    await downloadBook({
      bookId: 7,
      deviceId: 'device-1',
      deviceName: 'iPad',
      userId: 'user-1',
      destPath: join(tmpDir, 'ficciones.pdf'),
      nasClient: nas,
      writeFile: async (path, data) => {
        writers.push({ path, bytes: data })
      },
    })

    expect(writers).toHaveLength(1)
    expect(writers[0]!.path).toBe(join(tmpDir, 'ficciones.pdf'))
  })

  it('reports ACTUAL bytes received (from onProgress) to completeDownload, not the expected size', async () => {
    // RED test for #65. The mock downloadFile reports a single
    // onProgress(total) call with the 5-byte write. The flow must
    // thread THAT count into `bytesTransferred`, not
    // `SAMPLE_BOOK.file_size_bytes` (1_000).
    //
    // We use a custom mock that fires onProgress with a known,
    // distinct value so the assertion cannot accidentally pass
    // because of the existing 1_000 expectation.
    let observedBytes = 0
    const nas: InMemoryNasClient = {
      ...makeMockNasClient(),
      downloadFile: vi.fn(
        async (
          _bookId: number,
          destPath: string,
          onProgress: (bytes: number) => void,
          downloadOptions: { writeFile?: (path: string, data: Uint8Array) => Promise<void> } = {},
        ) => {
          const payload = new Uint8Array([10, 20, 30, 40, 50, 60, 70]) // 7 bytes
          onProgress(payload.byteLength)
          observedBytes = payload.byteLength
          const writeFile = downloadOptions.writeFile
          if (writeFile) {
            await writeFile(destPath, payload)
          }
        },
      ),
    }

    await downloadBook({
      bookId: 7,
      deviceId: 'device-1',
      deviceName: 'iPad',
      userId: 'user-1',
      destPath: join(tmpDir, 'ficciones.pdf'),
      nasClient: nas,
      writeFile: makeInMemoryWriter(),
    })

    // The mock fired onProgress(7) — the flow must thread 7
    // (the actual bytes received) into completeDownload, NOT
    // SAMPLE_BOOK.file_size_bytes (1_000) or 0.
    expect(observedBytes).toBe(7)
    expect(nas.completeDownload).toHaveBeenCalledWith(99, {
      completed: true,
      bytesTransferred: 7,
    })
  })
})
