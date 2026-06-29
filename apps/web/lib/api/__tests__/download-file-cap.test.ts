import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'

import {
  createNasClient,
  type NasClientOptions,
} from '../nas-client'

/**
 * TDD tests for `downloadFile` (PR-3-fix-B, issue #63).
 *
 * Before the fix `downloadFile` concatenated the entire response
 * body into a single `Uint8Array` via `drainToBuffer` and only
 * THEN wrote it to disk. A 5 GB response OOMs the Server Action.
 *
 * The fix:
 *  - stream chunks directly to the destination file (one writer
 *    per chunk, injected for tests)
 *  - cap the cumulative byte count at `maxBytes` (default
 *    `MAX_DOWNLOAD_BYTES = 1 GiB`) and throw `DOWNLOAD_OVERFLOW`
 *    on overflow
 *  - delete the partial destination file when the transfer
 *    fails (so a failed retry doesn't leave stale bytes that
 *    look like progress)
 *  - honour `start: bytesAlreadyOnDisk` for resume: the
 *    cumulative count passed to `onProgress` includes the
 *    pre-existing bytes (the caller asked for a Range request,
 *    so the response carries only the tail)
 *
 * The chunked writer is injected via the existing `writeFile`
 * seam (`writeFile(path, data)`); for the streaming variant
 * `downloadFile` invokes the writer PER chunk (the data may be
 * up to one network chunk at a time, not the full body).
 */

const MAX_DOWNLOAD_BYTES = 1024 * 1024 * 1024 // 1 GiB

interface RecordedWrite {
  path: string
  bytes: number
}

function makeWriteRecorder(records: RecordedWrite[]): (path: string, data: Uint8Array) => Promise<void> {
  return async (path: string, data: Uint8Array): Promise<void> => {
    records.push({ path, bytes: data.byteLength })
  }
}

describe('downloadFile — streaming + size cap (#63)', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    delete process.env['ALEJANDRIA_NAS_URL']
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('streams chunks to the destination file via the injected writer (one call per chunk)', async () => {
    // Build a response with three discrete chunks. The new
    // implementation must call the writer 3 times, once per
    // chunk — NOT once with a concatenated buffer.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]))
        controller.enqueue(new Uint8Array([4, 5, 6]))
        controller.enqueue(new Uint8Array([7, 8, 9]))
        controller.close()
      },
    })
    const response = new Response(stream, {
      status: 206,
      headers: { 'content-range': 'bytes 0-8/9' },
    })
    const fetchImpl = vi.fn(async () => response)
    const records: RecordedWrite[] = []
    const writeFile = makeWriteRecorder(records)

    const client = createNasClient({
      fetch: fetchImpl as unknown as typeof fetch,
      baseUrl: 'http://nas.local:3000',
      token: 'jwt',
    })

    await client.downloadFile(7, '/tmp/dest.bin', () => {}, { writeFile })

    expect(records).toHaveLength(3)
    expect(records.map((r) => r.bytes)).toEqual([3, 3, 3])
  })

  it('throws DOWNLOAD_OVERFLOW when the cumulative byte count exceeds maxBytes', async () => {
    // 3 chunks of 100 bytes each = 300 bytes total. Cap at 150.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(100))
        controller.enqueue(new Uint8Array(100))
        controller.enqueue(new Uint8Array(100))
        controller.close()
      },
    })
    const response = new Response(stream, {
      status: 206,
      headers: { 'content-range': 'bytes 0-299/300' },
    })
    const fetchImpl = vi.fn(async () => response)
    const records: RecordedWrite[] = []
    const writeFile = makeWriteRecorder(records)

    const client = createNasClient({
      fetch: fetchImpl as unknown as typeof fetch,
      baseUrl: 'http://nas.local:3000',
      token: 'jwt',
    })

    await expect(
      client.downloadFile(7, '/tmp/dest.bin', () => {}, {
        writeFile,
        maxBytes: 150,
      }),
    ).rejects.toMatchObject({
      code: 'DOWNLOAD_OVERFLOW',
    })
    // The first 100-byte chunk was within the cap; the second
    // pushed cumulative to 200, which exceeds maxBytes=150, so
    // the writer was called once and the overflow fired on the
    // second chunk's pre-write check.
    expect(records).toHaveLength(1)
    expect(records[0]!.bytes).toBe(100)
  })

  it('deletes the partial destination file on overflow', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(100))
        controller.enqueue(new Uint8Array(100))
        controller.enqueue(new Uint8Array(100))
        controller.close()
      },
    })
    const response = new Response(stream, {
      status: 206,
      headers: { 'content-range': 'bytes 0-299/300' },
    })
    const fetchImpl = vi.fn(async () => response)
    const records: RecordedWrite[] = []
    const writeFile = makeWriteRecorder(records)
    const unlink = vi.fn(async (_path: string) => undefined)

    const client = createNasClient({
      fetch: fetchImpl as unknown as typeof fetch,
      baseUrl: 'http://nas.local:3000',
      token: 'jwt',
    })

    await expect(
      client.downloadFile(7, '/tmp/dest.bin', () => {}, {
        writeFile,
        unlink,
        maxBytes: 150,
      }),
    ).rejects.toMatchObject({
      code: 'DOWNLOAD_OVERFLOW',
    })
    expect(unlink).toHaveBeenCalledWith('/tmp/dest.bin')
  })

  it('honours start parameter — onProgress reports bytes already on disk + bytes received', async () => {
    // Resume scenario: 50 bytes already on disk, this chunk
    // carries 75 more bytes. Progress callback must report
    // cumulative 50 + 75 = 125 once the chunk lands.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(75))
        controller.close()
      },
    })
    const response = new Response(stream, {
      status: 206,
      headers: { 'content-range': 'bytes 50-124/125' },
    })
    const fetchImpl = vi.fn(async () => response)
    const records: RecordedWrite[] = []
    const writeFile = makeWriteRecorder(records)

    const client = createNasClient({
      fetch: fetchImpl as unknown as typeof fetch,
      baseUrl: 'http://nas.local:3000',
      token: 'jwt',
    })

    const progressValues: number[] = []
    await client.downloadFile(7, '/tmp/dest.bin', (bytes) => {
      progressValues.push(bytes)
    }, { writeFile, start: 50 })

    expect(progressValues[progressValues.length - 1]).toBe(125)
    expect(records).toHaveLength(1)
    expect(records[0]!.bytes).toBe(75)
  })

  it('throws DOWNLOAD_OVERFLOW when a single chunk would push the cumulative count above maxBytes', async () => {
    // Single 2 GiB chunk with a 1 GiB cap. The helper must
    // detect overflow on the chunk's pre-write check and
    // refuse to write any bytes.
    const big = new Uint8Array(2 * 1024 * 1024 * 1024)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(big)
        controller.close()
      },
    })
    const response = new Response(stream, {
      status: 206,
      headers: { 'content-range': 'bytes 0-99/2147483648' },
    })
    const fetchImpl = vi.fn(async () => response)
    const records: RecordedWrite[] = []
    const writeFile = makeWriteRecorder(records)

    const client = createNasClient({
      fetch: fetchImpl as unknown as typeof fetch,
      baseUrl: 'http://nas.local:3000',
      token: 'jwt',
    })

    await expect(
      client.downloadFile(7, '/tmp/dest.bin', () => {}, {
        writeFile,
        maxBytes: 1024 * 1024 * 1024,
      }),
    ).rejects.toMatchObject({
      code: 'DOWNLOAD_OVERFLOW',
    })
    expect(records).toHaveLength(0)
  })
})