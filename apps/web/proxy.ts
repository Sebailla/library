import { NextResponse, type NextRequest } from 'next/server'

import { requestIdMiddleware } from '@/lib/middleware/request-id'

/**
 * Root Next.js proxy (formerly `middleware.ts`, renamed in
 * Next.js 16). Mounted at the project root so it runs for
 * every dynamic request (pages, route handlers, server
 * actions, static assets).
 *
 * Currently the only behavior is the request-ID propagation
 * from `lib/middleware/request-id.ts` — additional proxy
 * logic (auth gate, rate limiting, tracing export) lands in
 * later PRs.
 *
 * The matcher excludes `/_next/*` static assets and image
 * optimization endpoints so we don't pay the per-request cost
 * on cacheable resources.
 */
export function proxy(request: NextRequest): NextResponse {
  return requestIdMiddleware(request)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}