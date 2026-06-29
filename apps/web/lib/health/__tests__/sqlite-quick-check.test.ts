import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'

/**
 * TDD tests for `lib/health/sqlite-quick-check.ts` (PR-3-fix-C, #61).
 *
 * `quick_check` is a cheaper variant of `integrity_check` — it
 * does NOT scan the entire file, only the b-tree pages. It is
 * the right primitive for a `/readyz` endpoint that is hit by
 * a load balancer every few seconds.
 *
 * The helper takes a `better-sqlite3` handle so it can be unit
 * tested against an in-memory DB without touching the disk.
 */

import { runSqliteQuickCheck } from '../sqlite-quick-check'

describe('lib/health/sqlite-quick-check (PR-3-fix-C, #61)', () => {
  it('returns ok=true against a healthy in-memory DB', () => {
    const db = new Database(':memory:')
    try {
      // SQLite requires at least one table for quick_check to
      // meaningfully run; an empty DB still returns ok, but we
      // want to mirror a real DB shape.
      db.exec('CREATE TABLE health_probe (id INTEGER PRIMARY KEY)')
      const result = runSqliteQuickCheck(db)
      expect(result.ok).toBe(true)
    } finally {
      db.close()
    }
  })

  it('returns ok=true on a freshly opened empty in-memory DB', () => {
    const db = new Database(':memory:')
    try {
      const result = runSqliteQuickCheck(db)
      // SQLite quick_check returns 'ok' even for an empty DB;
      // the helper should not false-positive on that case.
      expect(result.ok).toBe(true)
    } finally {
      db.close()
    }
  })

  it('returns ok=false with the underlying message when quick_check fails', () => {
    const db = new Database(':memory:')
    try {
      // Force a corruption-like state: drop a table mid-flight
      // so the schema is invalid. quick_check on a corrupted
      // schema returns a row describing the failure rather
      // than 'ok'.
      db.exec('CREATE TABLE t1 (id INTEGER)')
      db.exec('DROP TABLE t1')
      // quick_check may still pass on a dropped table because
      // SQLite just removes the file pages. Use pragma to
      // simulate a failed check by passing a deliberately
      // invalid handle — but a closed handle throws on access,
      // so we test the failure path by mocking the pragma
      // result instead.
      const result = runSqliteQuickCheck({
        pragma: (key: string) => {
          if (key === 'quick_check') {
            return [{ quick_check: 'database disk image malformed' }]
          }
          return []
        },
        close: () => undefined,
      } as unknown as Database.Database)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('database disk image malformed')
      }
    } finally {
      db.close()
    }
  })

  it('returns ok=false when quick_check throws (db is closed / corrupt)', () => {
    const result = runSqliteQuickCheck({
      pragma: () => {
        throw new Error('SQLITE_CORRUPT: database disk image is malformed')
      },
      close: () => undefined,
    } as unknown as Database.Database)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/SQLITE_CORRUPT|mdisk/i)
    }
  })

  it('returns ok=false when quick_check returns an empty array (driver-level failure)', () => {
    const result = runSqliteQuickCheck({
      pragma: () => [],
      close: () => undefined,
    } as unknown as Database.Database)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeTruthy()
    }
  })
})