import type Database from 'better-sqlite3'

/**
 * `PRAGMA quick_check` helper for the `/readyz` route
 * (PR-3-fix-C, issue #61).
 *
 * `quick_check` is the cheap variant of `integrity_check` —
 * it does NOT scan the entire file, only the b-tree pages,
 * and runs in O(pages) instead of O(file-size). That makes it
 * the right primitive for a `/readyz` endpoint that a load
 * balancer polls every few seconds.
 *
 * The helper takes an already-open `better-sqlite3` handle so
 * the caller controls the connection lifecycle. The
 * `/readyz` route handler opens the local DB via
 * {@link openLocalDb} and closes it before returning.
 *
 * The helper never throws — every failure mode returns
 * `{ ok: false, error }` so the route handler can map it to
 * a 503 response without a try/catch.
 */

/** Minimal surface the helper needs from a `better-sqlite3` handle. */
export interface SqliteLike {
  pragma(key: 'quick_check'): unknown
  close(): void
}

export type QuickCheckResult =
  | { ok: true }
  | { ok: false; error: string }

/**
 * Run `PRAGMA quick_check` against the supplied handle. The
 * pragma returns an array of rows; the canonical OK response
 * is a single row whose only value is the string `'ok'`.
 *
 * Any deviation (no row, row with a different value, pragma
 * throws) is treated as a failure so the caller can serve
 * 503.
 */
export function runSqliteQuickCheck(handle: SqliteLike): QuickCheckResult {
  let rows: unknown
  try {
    rows = handle.pragma('quick_check')
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'sqlite quick_check threw',
    }
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, error: 'sqlite quick_check returned no rows' }
  }
  const first = rows[0]
  if (typeof first !== 'object' || first === null) {
    return { ok: false, error: `unexpected quick_check row shape: ${String(first)}` }
  }
  const values = Object.values(first as Record<string, unknown>)
  if (values.length === 1 && values[0] === 'ok') {
    return { ok: true }
  }
  // Failure mode: single row whose value is the error message
  // (e.g. `'database disk image malformed'`).
  const message = values.map((v) => String(v)).join(' ')
  return { ok: false, error: message || 'sqlite quick_check failed' }
}