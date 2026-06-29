import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * TDD tests for `lib/middleware/request-id.ts` (PR-3-fix-C, #61).
 *
 * The middleware:
 *  - Reads `X-Request-Id` from the incoming request headers
 *    (or generates a fresh one if absent).
 *  - Sets `X-Request-Id` on the outgoing response so the caller
 *    can correlate logs end-to-end.
 *  - Attaches the id via `setRequestId` so any `lib/log` call
 *    emitted during the request lifetime carries it.
 *
 * The middleware is the only place that touches `setRequestId` /
 * `clearRequestId`. Tests mock `next/server` so we don't need a
 * running Next.js instance, and capture the `setRequestId`
 * invocation to verify the propagation.
 */

// `vi.hoisted` lets us declare mock state before `vi.mock`
// is hoisted by Vitest. Without this the `vi.fn()` calls
// below would be evaluated at module-import time and the
// captured references would be `undefined`.
const mocks = vi.hoisted(() => ({
  nextResponseHeaders: {} as Record<string, string>,
  setRequestIdMock: vi.fn(),
  clearRequestIdMock: vi.fn(),
}))

vi.mock('next/server', () => ({
  NextResponse: {
    next: (init?: { headers?: Record<string, string> }) => {
      if (init?.headers) {
        Object.assign(mocks.nextResponseHeaders, init.headers)
      }
      return {
        headers: mocks.nextResponseHeaders,
      }
    },
  },
}))

vi.mock('@/lib/log', () => ({
  setRequestId: mocks.setRequestIdMock,
  clearRequestId: mocks.clearRequestIdMock,
}))

import {
  requestIdMiddleware,
  generateRequestId,
  extractRequestId,
} from '../request-id'

function buildRequest(headers: Record<string, string> = {}): Request {
  return new Request('https://example.com/foo', {
    method: 'GET',
    headers,
  })
}

describe('lib/middleware/request-id (PR-3-fix-C, #61)', () => {
  beforeEach(() => {
    mocks.setRequestIdMock.mockReset()
    mocks.clearRequestIdMock.mockReset()
    for (const key of Object.keys(mocks.nextResponseHeaders)) {
      delete mocks.nextResponseHeaders[key]
    }
  })

  describe('extractRequestId', () => {
    it('returns the existing X-Request-Id header value', () => {
      expect(extractRequestId(buildRequest({ 'x-request-id': 'req-abc' }))).toBe(
        'req-abc',
      )
    })

    it('returns null when the header is absent', () => {
      expect(extractRequestId(buildRequest())).toBeNull()
    })

    it('returns null when the header is whitespace', () => {
      expect(extractRequestId(buildRequest({ 'x-request-id': '   ' }))).toBeNull()
    })
  })

  describe('generateRequestId', () => {
    it('returns a non-empty string id', () => {
      const id = generateRequestId()
      expect(typeof id).toBe('string')
      expect(id.length).toBeGreaterThan(0)
    })

    it('returns a unique id on every call', () => {
      const a = generateRequestId()
      const b = generateRequestId()
      expect(a).not.toBe(b)
    })
  })

  describe('requestIdMiddleware', () => {
    it('propagates the supplied X-Request-Id to the response', () => {
      const req = buildRequest({ 'x-request-id': 'req-supplied-1' })
      const res = requestIdMiddleware(req as unknown as import('next/server').NextRequest)
      // The mock exposes the headers as a plain record so the
      // test can introspect them without a Headers polyfill.
      const headers = res.headers as unknown as Record<string, string>
      expect(headers['X-Request-Id']).toBe('req-supplied-1')
    })

    it('generates a fresh id when none is supplied', () => {
      const req = buildRequest()
      const res = requestIdMiddleware(req as unknown as import('next/server').NextRequest)
      const headers = res.headers as unknown as Record<string, string>
      const id = headers['X-Request-Id']
      expect(typeof id).toBe('string')
      expect(id?.length).toBeGreaterThan(0)
    })

    it('calls setRequestId with the resolved id', () => {
      const req = buildRequest({ 'x-request-id': 'req-trace-9' })
      requestIdMiddleware(req as unknown as import('next/server').NextRequest)
      expect(mocks.setRequestIdMock).toHaveBeenCalledWith('req-trace-9')
    })

    it('calls clearRequestId so the id never leaks past the request', () => {
      // The middleware MUST clear the id after the response
      // is built so a subsequent unrelated request can't
      // accidentally inherit the previous trace id.
      const req = buildRequest({ 'x-request-id': 'req-cleanup' })
      requestIdMiddleware(req as unknown as import('next/server').NextRequest)
      expect(mocks.clearRequestIdMock).toHaveBeenCalledTimes(1)
    })
  })
})