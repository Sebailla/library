import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * TDD tests for the `/livez` and `/readyz` route handlers
 * (PR-3-fix-C, issue #61).
 *
 * `/livez` is a process-up probe — it MUST always return 200
 * once the Next.js worker is up. A liveness probe failure
 * means the process needs to be restarted.
 *
 * `/readyz` is a dependency probe — it runs
 * `PRAGMA quick_check` against the local SQLite and returns
 * 503 if the DB is corrupt / unreadable. A readiness failure
 * means the load balancer should stop sending traffic to
 * this instance, but the process itself is fine.
 */

const openLocalDbMock = vi.fn()
const runSqliteQuickCheckMock = vi.fn()

vi.mock('@/lib/db/local-db', () => ({
  openLocalDb: openLocalDbMock,
}))

vi.mock('@/lib/health/sqlite-quick-check', () => ({
  runSqliteQuickCheck: runSqliteQuickCheckMock,
}))

vi.mock('@/lib/log', () => ({
  logError: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}))

beforeEach(() => {
  openLocalDbMock.mockReset()
  runSqliteQuickCheckMock.mockReset()
  openLocalDbMock.mockReturnValue({
    pragma: vi.fn(),
    close: vi.fn(),
  })
})

describe('/livez (PR-3-fix-C, #61)', () => {
  it('returns 200 with an ok body', async () => {
    const { GET } = await import('@/app/livez/route')
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ status: 'ok' })
  })

  it('does NOT touch the database (liveness is process-only)', async () => {
    const { GET } = await import('@/app/livez/route')
    await GET()
    expect(openLocalDbMock).not.toHaveBeenCalled()
  })
})

describe('/readyz (PR-3-fix-C, #61)', () => {
  it('returns 200 when sqlite quick_check passes', async () => {
    runSqliteQuickCheckMock.mockReturnValue({ ok: true })
    const { GET } = await import('@/app/readyz/route')
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(body.checks.sqlite).toBe('ok')
  })

  it('returns 503 when sqlite quick_check fails', async () => {
    runSqliteQuickCheckMock.mockReturnValue({
      ok: false,
      error: 'database disk image malformed',
    })
    const { GET } = await import('@/app/readyz/route')
    const res = await GET()
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.status).toBe('degraded')
    expect(body.checks.sqlite).toBe('database disk image malformed')
  })

  it('returns 503 when openLocalDb throws (db unreadable)', async () => {
    openLocalDbMock.mockImplementation(() => {
      throw new Error('SQLITE_CORRUPT: database disk image is malformed')
    })
    const { GET } = await import('@/app/readyz/route')
    const res = await GET()
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.status).toBe('degraded')
    expect(body.checks.sqlite).toMatch(/SQLITE_CORRUPT/)
  })

  it('closes the DB handle after the check', async () => {
    const close = vi.fn()
    openLocalDbMock.mockReturnValue({
      pragma: vi.fn(),
      close,
    })
    runSqliteQuickCheckMock.mockReturnValue({ ok: true })
    const { GET } = await import('@/app/readyz/route')
    await GET()
    expect(close).toHaveBeenCalledTimes(1)
  })
})