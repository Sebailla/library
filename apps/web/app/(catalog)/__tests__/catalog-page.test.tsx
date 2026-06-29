import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * TDD tests for `loadCatalog` (PR-3-fix-B, issue #64).
 *
 * The catalog route is a React Server Component that reads the
 * local SQLite via `openLocalDb().listBooks()`. Before the fix
 * a SQLite error (lock contention, corruption, permission
 * denied) 500s the route — `loadCatalog` had no try/catch.
 *
 * The fix mirrors `(nas)/browse/page.tsx`: wrap the read in
 * try/catch and return an empty list (with the empty-state CTA
 * still reachable) on failure. The empty list is what the
 * catalog renders when the library has no books.
 *
 * `loadCatalog` is exported so the test can drive it directly
 * (mirrors `loadReader` in `app/reader/[bookId]/page.tsx`).
 */

// `next/cache` exports `cacheLife` + `cacheTag` which require the
// Next.js `cacheComponents` runtime config (only available inside
// the Next.js dev server). In a vitest/jsdom env they throw, so
// we stub them as no-ops — the `'use cache'` directive at the
// top of `loadCatalog` is parsed at module-load time and ignored
// when no Next.js runtime is present.
vi.mock('next/cache', () => ({
  cacheLife: () => undefined,
  cacheTag: () => undefined,
  revalidateTag: () => undefined,
  revalidatePath: () => undefined,
}))

import { loadCatalog } from '../page'

describe('loadCatalog — SQLite error handling (#64)', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'alejandria-catalog-'))
    process.env['ALEJANDRIA_DATA_DIR'] = tmpDir
  })

  afterEach(() => {
    delete process.env['ALEJANDRIA_DATA_DIR']
    rmSync(tmpDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('returns the books list on a healthy DB', async () => {
    // Insert one row through the real openLocalDb so the read
    // path is exercised end-to-end.
    const { openLocalDb } = await import('../../../lib/db/local-db')
    const db = openLocalDb()
    try {
      db.insertBook({
        id: 'b-1',
        title: 'Ficciones',
        author: 'Borges',
        year: 1944,
        format: 'pdf',
        filePath: '/lib/ficciones.pdf',
        contentHash: 'sha256:abc',
        excerpt: '',
      })
    } finally {
      db.close()
    }

    const books = await loadCatalog()
    expect(books).toHaveLength(1)
    expect(books[0]).toMatchObject({ id: 'b-1', title: 'Ficciones' })
  })

  it('returns an empty list when openLocalDb throws (SQLite lock / corruption)', async () => {
    // Force openLocalDb to throw — simulates a locked or
    // corrupted library.sqlite. The catalog MUST render the
    // empty-state CTA, not crash the route.
    const localDb = await import('../../../lib/db/local-db')
    const spy = vi
      .spyOn(localDb, 'openLocalDb')
      .mockImplementation(() => {
        throw new Error('SQLite database disk image is malformed')
      })

    const books = await loadCatalog()
    expect(books).toEqual([])
    spy.mockRestore()
  })
})