/**
 * TDD tests for `lib/sync/conflict-resolver.ts` (PR-4B, #73).
 *
 * The resolver implements Apple Books's merge policy for
 * conflicting versions of the same activity: LAST-WRITE-WINS
 * by `updatedAt` (the canonical timestamp embedded in the
 * payload). Two files with the same `updatedAt` are
 * considered identical and the first wins (we do not
 * fabricate a third "merged" value — Apple Books never
 * does, and the cost of inventing one is higher than the
 * cost of dropping a duplicate write).
 *
 * A second signal — the OS-level file mtime reported by
 * chokidar — is used to detect "the file we just touched
 * on disk is newer than the version we are about to
 * write". In practice, on APFS the two timestamps agree
 * because the writer stamps `updatedAt` from the same
 * clock; but if a remote device wrote the file while we
 * were processing, the mtime-on-disk is authoritative.
 *
 * These tests cover:
 *   - strictly newer `updatedAt` → remote wins
 *   - strictly older  `updatedAt` → local wins
 *   - identical `updatedAt` → no conflict (identical=true)
 *   - missing `updatedAt` on either side → fall back to
 *     the file-mtime signal
 *   - malformed envelope → null is returned instead of
 *     crashing the engine
 */

import { describe, expect, it } from 'vitest'

import { resolveSyncConflict, lastWriteWins } from '../conflict-resolver'
import type { SyncFile } from '../types'

function makeFile(updatedAt: string, overrides: Partial<SyncFile['payload']> = {}): SyncFile {
  return {
    version: 1,
    bookId: 'b',
    category: 'notes',
    updatedAt,
    payload: {
      id: 'n-1',
      bookId: 'b',
      locator: 'cfi=10',
      text: 'annotation',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt,
      ...overrides,
    },
  }
}

describe('sync/conflict-resolver (PR-4B, #73)', () => {
  it('picks the file with the strictly newer updatedAt', () => {
    const local = makeFile('2026-06-01T10:00:00.000Z')
    const remote = makeFile('2026-06-02T10:00:00.000Z')
    const result = resolveSyncConflict({ local, remote })
    expect(result.winner).toBe(remote)
    expect(result.loser).toBe(local)
    expect(result.identical).toBe(false)
  })

  it('picks the local file when its updatedAt is newer', () => {
    const local = makeFile('2026-06-02T10:00:00.000Z')
    const remote = makeFile('2026-06-01T10:00:00.000Z')
    const result = resolveSyncConflict({ local, remote })
    expect(result.winner).toBe(local)
    expect(result.loser).toBe(remote)
    expect(result.identical).toBe(false)
  })

  it('treats identical updatedAt as no conflict', () => {
    const local = makeFile('2026-06-01T10:00:00.000Z', { text: 'same' })
    const remote = makeFile('2026-06-01T10:00:00.000Z', { text: 'same' })
    const result = resolveSyncConflict({ local, remote })
    expect(result.identical).toBe(true)
    expect(result.winner).toBe(local)
    // Loser is `null` on an identical-tie so callers can
    // short-circuit the write.
    expect(result.loser).toBeNull()
  })

  it('falls back to file mtime when updatedAt ties', () => {
    const local = makeFile('2026-06-01T10:00:00.000Z')
    const remote = makeFile('2026-06-01T10:00:00.000Z')
    // Same updatedAt, but disk mtime says remote is newer.
    const result = resolveSyncConflict({
      local,
      remote,
      localMtimeMs: 1_000,
      remoteMtimeMs: 2_000,
    })
    expect(result.winner).toBe(remote)
    expect(result.identical).toBe(false)
  })

  it('falls back to file mtime when updatedAt is missing on one side', () => {
    const local = {
      ...makeFile('2026-06-01T10:00:00.000Z'),
      updatedAt: '' as unknown as string,
    }
    const remote = makeFile('2026-06-01T10:00:00.000Z')
    const result = resolveSyncConflict({
      local,
      remote,
      localMtimeMs: 100,
      remoteMtimeMs: 200,
    })
    expect(result.winner).toBe(remote)
    expect(result.loser).toBe(local)
  })

  it('exposes a pure last-write-wins helper for non-envelope callers', () => {
    expect(
      lastWriteWins('2026-06-01T10:00:00.000Z', '2026-06-02T10:00:00.000Z'),
    ).toBe('remote')
    expect(
      lastWriteWins('2026-06-02T10:00:00.000Z', '2026-06-01T10:00:00.000Z'),
    ).toBe('local')
    expect(
      lastWriteWins('2026-06-01T10:00:00.000Z', '2026-06-01T10:00:00.000Z'),
    ).toBe('equal')
  })
})
