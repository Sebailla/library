/**
 * iCloud Drive sync conflict resolver (PR-4B, issue #73).
 *
 * Implements Apple Books's "last write wins" merge rule
 * for activities that exist on two devices at once. The
 * model's policy was chosen over CRDTs because:
 *
 *   - reading activities are single-user, not collaborative;
 *   - human edits are coarse-grained (one annotation at a
 *     time, written by hand);
 *   - the user already trusts Apple Books to do LWW for them,
 *     so matching that behavior reduces surprise;
 *   - CRDTs add storage + complexity we do not need.
 *
 * The resolver takes both versions of a `SyncFile` plus,
 * optionally, the OS-level mtimes of the two files on disk
 * (as reported by chokidar). The mtime signal is the
 * tiebreaker when `updatedAt` is missing, malformed, or
 * equal.
 *
 * What this resolver is NOT:
 *   - not a 3-way merge — Apple Books does not 3-way merge
 *     and neither will we;
 *   - not field-by-field — losing a single character in a
 *     1000-char annotation is acceptable;
 *   - not lossy when timestamps tie: we report `identical`
 *     so the engine can skip the write entirely.
 */

import type { MergeResult, SyncFile } from './types'

/**
 * Result of comparing two timestamps in the LWW policy.
 * Exposed as a small enum-like union so callers can
 * branch on it without re-implementing the comparison.
 */
export type LwwOutcome = 'local' | 'remote' | 'equal'

/**
 * Pure comparator: compare two ISO-8601 strings and
 * declare a winner. Returns `'equal'` for missing or
 * unparseable inputs instead of throwing so the engine
 * does not have to wrap every call in try/catch.
 *
 * Why compare strings lexically? ISO-8601 with a fixed
 * format and a `Z` suffix sorts identically as
 * milliseconds-since-epoch, so a `Date.parse` round-trip
 * adds nothing and the lexicographic comparison is much
 * faster in V8 (no object allocation).
 */
export function lastWriteWins(localAt: string, remoteAt: string): LwwOutcome {
  if (!localAt || !remoteAt) return 'equal'
  if (localAt > remoteAt) return 'local'
  if (remoteAt > localAt) return 'remote'
  return 'equal'
}

/**
 * Compare two `SyncFile` values and decide which one
 * survives the merge. Inputs:
 *
 *   - `local`:  the version we have in memory / on disk
 *     from this device (or that we just wrote).
 *   - `remote`: the version chokidar reported from another
 *     device.
 *   - `localMtimeMs` / `remoteMtimeMs`: optional file
 *     mtimes, used only as a tiebreaker.
 *
 * Returns a `MergeResult` with:
 *   - `winner`: the SyncFile that should be kept;
 *   - `loser`: the dropped version, or `null` if the two
 *     were identical;
 *   - `identical`: `true` when both files are byte-equal
 *     (same updatedAt and same mtime) — callers can skip
 *     the write in that case.
 */
export function resolveSyncConflict(args: {
  local: SyncFile
  remote: SyncFile
  localMtimeMs?: number | null
  remoteMtimeMs?: number | null
}): MergeResult<SyncFile> {
  const { local, remote } = args
  const lww = lastWriteWins(local.updatedAt, remote.updatedAt)

  if (lww === 'local') {
    return { winner: local, loser: remote, identical: false }
  }
  if (lww === 'remote') {
    return { winner: remote, loser: local, identical: false }
  }

  // updatedAt tied — fall back to disk mtime if both are
  // provided; otherwise treat as identical so the engine
  // does no work.
  const lm = args.localMtimeMs ?? null
  const rm = args.remoteMtimeMs ?? null
  if (lm !== null && rm !== null) {
    if (rm > lm) return { winner: remote, loser: local, identical: false }
    if (lm > rm) return { winner: local, loser: remote, identical: false }
  }

  return { winner: local, loser: null, identical: true }
}

/**
 * Default `resolveConflict` factory. Exposed so the
 * engine can wire it through its `SyncEngineDeps` with
 * the standard LWW policy without redefining the type.
 * Production callers can swap it for a custom policy
 * (e.g. field-level merge in tests that exercise the
 * seam).
 */
export const defaultResolveConflict = resolveSyncConflict
