import { describe, expect, it, vi } from 'vitest'

import { downloadWithRange } from '../range-client'

/**
 * TDD tests for `lib/download/range-client.ts` (PR-3C).
 *
 * The range client is a pure, dependency-injected transport that
 * takes a `fetch` implementation, a URL, and a destination path
 * and writes the response body to disk while emitting progress
 * events. The contract under test:
 *
 *  - It always issues `Range: bytes=<start>-` (start = 0 by default).
 *  - It accepts 206 Partial Content AND 200 OK as success.
 *  - It is resumable: the caller can pass `start` to skip the
 *    already-downloaded prefix.
 *  - The progress callback receives the cumulative byte count.
 *  - It exposes a Node-style writable factory (writeFile) so the
 *    test can assert on the bytes actually written.
 */

function makeStreamResponse(
  chunks: readonly Uint8Array[],
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk)
      }
      controller.close()
    },
  })
  return new Response(stream, {
    status: init.status ?? 206,
    headers: init.headers,
  })
}

interface RecordedCall {
  url: string
  init: RequestInit
  bytes: Uint8Array
}

interface Recorder {
  fetch: RangeClientFetch
  calls: RecordedCall[]
  writtenPaths: string[]
}

function makeRecorder(
  responder: (call: RecordedCall) => Response | Promise<Response>,
): Recorder {
  const calls: RecordedCall[] = []
  const writtenPaths: string[] = []
  const writeFile = vi.fn(async (path: string, data: Uint8Array) => {
    writtenPaths.push(path)
    calls[calls.length - 1]!.bytes = data
  })
  const fetch: typeof globalThis.fetch = vi.fn(async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString()
    const call: RecordedCall = { url, init: init ?? { method: 'GET' }, bytes: new Uint8Array() }
    calls.push(call)
    return responder(call)
  }) as unknown as typeof globalThis.fetch
  return { fetch, calls, writtenPaths } as Recorder & { writeFile: typeof writeFile }
}

describe('range-client (PR-3C)', () => {
  it('issues Range: bytes=0- when no start offset is given', async () => {
    const recorder = makeRecorder(() =>
      makeStreamResponse([new Uint8Array([1, 2, 3, 4])], {
        status: 206,
        headers: { 'content-range': 'bytes 0-3/4' },
      }),
    )
    const fetchImpl = recorder.fetch as unknown as typeof fetch

    await downloadWithRange('http://nas.local/api/files/7', '/tmp/dest.bin', fetchImpl, {
      writeFile: async () => {},
    })

    expect(recorder.calls[0]!.init.headers).toMatchObject({ range: 'bytes=0-' })
  })

  it('accepts a 206 Partial Content response and writes the body to disk', async () => {
    const data = new Uint8Array([10, 20, 30, 40, 50])
    const recorder = makeRecorder(() =>
      makeStreamResponse([data], {
        status: 206,
        headers: { 'content-range': 'bytes 0-4/5' },
      }),
    )
    const writeFile = vi.fn(async () => {})
    const fetchImpl = recorder.fetch as unknown as typeof fetch

    await downloadWithRange('http://nas.local/api/files/7', '/tmp/dest.bin', fetchImpl, {
      writeFile,
    })

    expect(writeFile).toHaveBeenCalledTimes(1)
    const [path, bytes] = writeFile.mock.calls[0]!
    expect(path).toBe('/tmp/dest.bin')
    expect(Array.from(bytes as Uint8Array)).toEqual([10, 20, 30, 40, 50])
  })

  it('accepts a 200 OK fallback (no Range support)', async () => {
    const data = new Uint8Array([1, 2, 3])
    const recorder = makeRecorder(() =>
      makeStreamResponse([data], { status: 200 }),
    )
    const writeFile = vi.fn(async () => {})
    const fetchImpl = recorder.fetch as unknown as typeof fetch

    await downloadWithRange('http://nas.local/api/files/7', '/tmp/dest.bin', fetchImpl, {
      writeFile,
    })

    expect(writeFile).toHaveBeenCalledTimes(1)
  })

  it('is resumable: passes start byte to the Range header', async () => {
    const recorder = makeRecorder(() =>
      makeStreamResponse([new Uint8Array([9, 9, 9])], {
        status: 206,
        headers: { 'content-range': 'bytes 5-7/8' },
      }),
    )
    const writeFile = vi.fn(async () => {})
    const fetchImpl = recorder.fetch as unknown as typeof fetch

    await downloadWithRange('http://nas.local/api/files/7', '/tmp/dest.bin', fetchImpl, {
      start: 5,
      writeFile,
    })

    expect(recorder.calls[0]!.init.headers).toMatchObject({ range: 'bytes=5-' })
  })

  it('invokes onProgress with the cumulative byte count', async () => {
    const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])]
    const recorder = makeRecorder(() => makeStreamResponse(chunks))
    const writeFile = vi.fn(async () => {})
    const fetchImpl = recorder.fetch as unknown as typeof fetch

    const progressValues: number[] = []
    await downloadWithRange('http://nas.local/api/files/7', '/tmp/dest.bin', fetchImpl, {
      writeFile,
      onProgress: (bytes) => {
        progressValues.push(bytes)
      },
    })

    // Two chunks (3 + 3) should produce two progress callbacks;
    // the final total must reflect the full body size.
    expect(progressValues.length).toBeGreaterThanOrEqual(2)
    expect(progressValues[progressValues.length - 1]).toBe(6)
  })

  it('throws when the response status is neither 200 nor 206', async () => {
    const recorder = makeRecorder(() =>
      new Response('not found', { status: 404, statusText: 'Not Found' }),
    )
    const fetchImpl = recorder.fetch as unknown as typeof fetch
    const writeFile = vi.fn(async () => {})

    await expect(
      downloadWithRange('http://nas.local/api/files/7', '/tmp/dest.bin', fetchImpl, {
        writeFile,
      }),
    ).rejects.toThrow(/404/)
  })

  it('returns the total bytes written', async () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7])
    const recorder = makeRecorder(() => makeStreamResponse([data]))
    const fetchImpl = recorder.fetch as unknown as typeof fetch

    const total = await downloadWithRange(
      'http://nas.local/api/files/7',
      '/tmp/dest.bin',
      fetchImpl,
      { writeFile: async () => {} },
    )

    expect(total).toBe(7)
  })
})
