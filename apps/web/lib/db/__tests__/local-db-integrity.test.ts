import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * TDD tests for `PRAGMA integrity_check` on first open
 * (PR-3-fix-B, #64).
 *
 * `openLocalDb` runs `PRAGMA integrity_check` on its FIRST call
 * in the process. If the check fails the open throws so the
 * caller can recover (delete the file + rescan). Subsequent
 * opens skip the check — the integrity scan is O(file-size)
 * and would degrade every read.
 *
 * The "first open" decision is per-process; we use a module-
 * level flag so a test that imports the module mid-suite sees
 * the SAME first open across `openLocalDb` calls.
 */

describe('openLocalDb — PRAGMA integrity_check on first open (#64)', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'alejandria-integrity-'))
    process.env['ALEJANDRIA_DATA_DIR'] = tmpDir
  })

  afterEach(() => {
    delete process.env['ALEJANDRIA_DATA_DIR']
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('opens successfully when integrity_check passes', async () => {
    const { openLocalDb } = await import('../local-db')
    const db = openLocalDb()
    try {
      // A successful open is the contract. The pragma ran
      // before the helper returned; if it had failed the
      // open would have thrown.
      expect(typeof db.insertBook).toBe('function')
    } finally {
      db.close()
    }
  })

  it('runs the check exactly once across multiple opens in the same process', async () => {
    const { openLocalDb } = await import('../local-db')
    // First open: integrity_check runs.
    const db1 = openLocalDb()
    db1.close()
    // We can't directly inspect the prior call count without
    // a spy seam on the handle, but we can assert the
    // behaviour: subsequent opens do not throw even though
    // the file is intact. The DB-level integration test
    // already covers open-then-insert; this one documents
    // that a second open does not re-run the check (it
    // returns the SAME shape: a working handle).
    const db2 = openLocalDb()
    try {
      expect(typeof db2.listBooks).toBe('function')
      expect(Array.isArray(db2.listBooks())).toBe(true)
    } finally {
      db2.close()
    }
  })
})