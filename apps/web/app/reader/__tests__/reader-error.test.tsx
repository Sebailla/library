import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { render } from '@testing-library/react'

/**
 * TDD tests for `loadReader` error handling (PR-3-fix-B, #64).
 *
 * Before the fix a SQLite error (lock contention, corruption)
 * 500s `/reader/[bookId]`. The fix wraps the read in try/catch
 * and renders a friendly error JSX instead.
 *
 * The contract pinned here:
 *   1. Healthy DB → existing behaviour (book found / not found
 *      JSX). We don't regress the existing test contract.
 *   2. openLocalDb throws → loadReader returns JSX containing
 *      a friendly error message (NOT a thrown promise).
 */

vi.mock('next/cache', () => ({
  cacheLife: () => undefined,
  cacheTag: () => undefined,
  revalidateTag: () => undefined,
  revalidatePath: () => undefined,
}))

import { loadReader } from '../[bookId]/page'

describe('loadReader — SQLite error handling (#64)', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'alejandria-reader-'))
    process.env['ALEJANDRIA_DATA_DIR'] = tmpDir
  })

  afterEach(() => {
    delete process.env['ALEJANDRIA_DATA_DIR']
    rmSync(tmpDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('returns friendly error JSX when openLocalDb throws (SQLite lock / corruption)', async () => {
    // Force openLocalDb to throw — simulates a locked or
    // corrupted library.sqlite. The reader MUST render a
    // friendly fallback, not crash the route.
    const localDb = await import('../../../lib/db/local-db')
    const spy = vi
      .spyOn(localDb, 'openLocalDb')
      .mockImplementation(() => {
        throw new Error('SQLITE_BUSY: database is locked')
      })

    const jsx = await loadReader('b-1')
    const { container } = render(jsx)
    // The fallback JSX contains a "temporarily unavailable"
    // message — operators can grep the rendered HTML for it.
    expect(container.textContent).toMatch(
      /temporarily unavailable|library.*error/i,
    )
    spy.mockRestore()
  })
})