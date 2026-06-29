import { NextResponse, type NextRequest } from 'next/server'

import { clearRequestId, setRequestId } from '@/lib/log'

/**
 * Request-ID middleware (PR-3-fix-C, issue #61).
 *
 * Generates (or accepts) an `X-Request-Id` per request and
 * propagates it via:
 *
 *  1. the outgoing response header (so the caller can
 *     correlate client + server logs end-to-end), and
 *  2. the logger's `setRequestId` (so every record emitted
 *     during the request lifetime carries the id).
 *
 * The id is cleared after the response is built so it never
 * leaks to a subsequent unrelated request on the same Node
 * worker (RSC + Server Actions are single-threaded so a
 * module-local variable is safe).
 *
 * The middleware runs on every request because it is mounted
 * as the project root middleware (`middleware.ts`). The
 * cost is one UUID generation per request — negligible.
 */

/** Length of the hex portion of the generated request id. */
const REQUEST_ID_LENGTH = 16

/** Header used both for ingestion and propagation. */
export const REQUEST_ID_HEADER = 'X-Request-Id'

/**
 * Read the existing `X-Request-Id` header from the request.
 * Returns `null` when absent or whitespace-only so callers can
 * fall through to {@link generateRequestId}.
 */
export function extractRequestId(request: Pick<Request, 'headers'>): string | null {
  const value = request.headers.get(REQUEST_ID_HEADER)
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Generate a fresh request id. Uses `crypto.randomUUID` when
 * available (Node 20+, browsers); falls back to a Math.random
 * hex string otherwise so the helper is safe under jsdom (Vitest
 * with `environment: 'jsdom'` may not expose
 * `crypto.randomUUID` consistently).
 */
export function generateRequestId(): string {
  const c =
    typeof globalThis !== 'undefined' && 'crypto' in globalThis
      ? (globalThis.crypto as { randomUUID?: () => string })
      : null
  if (c && typeof c.randomUUID === 'function') {
    // Strip the dashes so the id is safe for HTTP headers and
    // log search. The 16-byte hash is plenty for tracing.
    return c.randomUUID().replace(/-/g, '').slice(0, REQUEST_ID_LENGTH)
  }
  // Fallback: 16 hex chars.
  let out = ''
  while (out.length < REQUEST_ID_LENGTH) {
    out += Math.floor(Math.random() * 0xffffffff).toString(16)
  }
  return out.slice(0, REQUEST_ID_LENGTH)
}

/**
 * Run the middleware: resolve the request id, attach it to
 * the logger + outgoing response, then clear the logger state
 * so the id never leaks to the next request.
 */
export function requestIdMiddleware(request: NextRequest): NextResponse {
  const id = extractRequestId(request) ?? generateRequestId()
  setRequestId(id)
  try {
    return NextResponse.next({
      headers: { [REQUEST_ID_HEADER]: id },
    })
  } finally {
    // Clear the id so a subsequent request on this worker
    // cannot accidentally inherit it.
    clearRequestId()
  }
}