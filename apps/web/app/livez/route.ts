import { NextResponse } from 'next/server'

/**
 * `GET /livez` — process liveness probe (PR-3-fix-C, issue #61).
 *
 * Returns `200 OK` as long as the Next.js worker is up and
 * responsive. A liveness probe failure means the container
 * orchestrator should restart this process.
 *
 * Per Kubernetes / RFC conventions this endpoint MUST NOT
 * touch external dependencies (no DB, no NAS). It only
 * confirms that the process can serve HTTP. The dependency
 * check lives at `/readyz`.
 *
 * No-cache so the load balancer never sees a stale 200 from
 * an unhealthy instance that was previously healthy.
 */

export function GET(): NextResponse {
  return NextResponse.json(
    { status: 'ok' },
    {
      status: 200,
      headers: {
        'cache-control': 'no-store',
      },
    },
  )
}