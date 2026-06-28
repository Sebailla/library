import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openLocalDb } from '../../db/local-db'
import { scanFile, type SidecarSpawnFn } from '../local-pipeline'

/**
 * TDD tests for `lib/scan/local-pipeline.ts` (PR-3B).
 *
 * The pipeline must:
 *  - spawn `python -m alejandria_sidecar extract <path>` (the PR1 CLI)
 *  - parse the JSON envelope it returns
 *  - insert the resulting book into the local SQLite
 *
 * The spawn step is injected via `SidecarSpawnFn` so tests run
 * without Python.
 */

const SUCCESS_ENVELOPE = {
  schema_version: 1,
  result: {
    book_id: 'sidecar-book-1',
    title: 'Rayuela',
    author: 'Julio Cortázar',
    year: 1963,
    format: 'epub',
    content_hash: 'sha256:rayuela',
    excerpt: 'Una novela que se puede leer de muchas formas.',
  },
} as const

const ERROR_ENVELOPE = {
  schema_version: 1,
  error: { code: 'NOT_IMPLEMENTED', message: 'extract is not yet implemented' },
} as const

describe('scan pipeline (PR-3B)', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'alejandria-scan-'))
    process.env['ALEJANDRIA_DATA_DIR'] = tmpDir
  })

  afterEach(() => {
    delete process.env['ALEJANDRIA_DATA_DIR']
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('spawns the sidecar, parses the JSON envelope, and inserts the book into the local DB', async () => {
    let captured: { command: string; args: readonly string[] } | null = null
    const spawn: SidecarSpawnFn = async (command, args) => {
      captured = { command, args }
      return { exitCode: 0, stdout: JSON.stringify(SUCCESS_ENVELOPE), stderr: '' }
    }

    const db = openLocalDb()
    try {
      const result = await scanFile('/library/cortazar/rayuela.epub', { spawn })

      // Spawn must target the PR1 sidecar with the file path as the
      // single positional arg.
      expect(captured).not.toBeNull()
      expect(captured!.command).toBe('python')
      expect(captured!.args).toEqual(['-m', 'alejandria_sidecar', 'extract', '/library/cortazar/rayuela.epub'])

      // Pipeline must hand the parsed metadata to the local DB.
      const stored = db.findById('sidecar-book-1')
      expect(stored).not.toBeNull()
      expect(stored).toMatchObject({
        id: 'sidecar-book-1',
        title: 'Rayuela',
        author: 'Julio Cortázar',
        year: 1963,
        format: 'epub',
        contentHash: 'sha256:rayuela',
        excerpt: 'Una novela que se puede leer de muchas formas.',
        filePath: '/library/cortazar/rayuela.epub',
      })

      // Returned handle mirrors what was inserted.
      expect(result.id).toBe('sidecar-book-1')
    } finally {
      db.close()
    }
  })

  it('throws when the sidecar returns an error envelope', async () => {
    const spawn: SidecarSpawnFn = async () => ({
      exitCode: 2,
      stdout: JSON.stringify(ERROR_ENVELOPE),
      stderr: '',
    })

    await expect(
      scanFile('/library/missing.epub', { spawn }),
    ).rejects.toThrow(/NOT_IMPLEMENTED/)
  })

  it('throws when the sidecar exits with a non-zero code and no JSON', async () => {
    const spawn: SidecarSpawnFn = async () => ({
      exitCode: 5,
      stdout: '',
      stderr: 'file unreadable',
    })

    await expect(
      scanFile('/library/broken.epub', { spawn }),
    ).rejects.toThrow(/code 5/)
  })

  it('detects unsupported extensions before spawning', async () => {
    let called = false
    const spawn: SidecarSpawnFn = async () => {
      called = true
      return { exitCode: 0, stdout: '', stderr: '' }
    }

    await expect(
      scanFile('/library/mystery.xyz', { spawn }),
    ).rejects.toThrow(/unsupported/i)

    expect(called).toBe(false)
  })
})
