import { NextResponse } from 'next/server'

import { openLocalDb } from '@/lib/db/local-db'
import { runSqliteQuickCheck } from '@/lib/health/sqlite-quick-check'
import { logError } from '@/lib/log'

/**
 * `GET /readyz` — readiness probe (PR-3-fix-C, issue #61).
 *
 * Returns `200 OK` when every dependency the web app needs to
 * serve traffic is healthy, and `503 Service Unavailable` when
 * any dependency is degraded.
 *
 * Currently the only dependency is the local SQLite (`library.sqlite`).
 * A failure here means the load balancer should stop sending
 * traffic to this instance; the process itself is fine (the
 * `/livez` probe will still return 200).
 *
 * The local DB is opened, probed via `PRAGMA quick_check`, and
 * closed within the same handler so we never leak a handle. The
 * helper {@link runSqliteQuickCheck} never throws — every
 * failure mode returns `{ ok: false, error }`.
 */

interface ReadyBody {
  status: 'ok' | 'degraded'
  checks: {
    sqlite: 'ok' | string
  }
}

export function GET(): NextResponse {
  try {
    const db = openLocalDb()
    try {
      const result = runSqliteQuickCheck({
        pragma: (key) => db.pragma(key),
        close: () => undefined,
      })
      if (result.ok) {
        const body: ReadyBody = { status: 'ok', checks: { sqlite: 'ok' } }
        return NextResponse.json(body, {
          status: 200,
          headers: { 'cache-control': 'no-store' },
        })
      }
      logError('readyz', new Error(result.error), { check: 'sqlite' })
      const body: ReadyBody = { status: 'degraded', checks: { sqlite: result.error } }
      return NextResponse.json(body, {
        status: 503,
        headers: { 'cache-control': 'no-store' },
      })
    } finally {
      db.close()
    }
  } catch (err) {
    logError('readyz', err, { check: 'sqlite', stage: 'open' })
    const message = err instanceof Error ? err.message : 'sqlite unreachable'
    const body: ReadyBody = { status: 'degraded', checks: { sqlite: message } }
    return NextResponse.json(body, {
      status: 503,
      headers: { 'cache-control': 'no-store' },
    })
  }
}