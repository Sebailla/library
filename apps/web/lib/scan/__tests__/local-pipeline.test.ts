import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openLocalDb } from '../../db/local-db'
import { scanFile, type SidecarSpawnFn } from '../local-pipeline'

/**
 * TDD tests for `lib/scan/local-pipeline.ts` (PR-3B + PR-3-fix-B).
 *
 * The pipeline must:
 *  - spawn `python -m alejandria_sidecar extract <path>` (the PR1 CLI)
 *  - parse the JSON envelope it returns
 *  - insert the resulting book into the local SQLite
 *
 * PR-3-fix-B (#60, BLOCKER) added:
 *  - path sanitization via `@alejandria/sidecar.sanitizePath`
 *    (rejects empty / `-`-prefixed / `..`-escaping paths and any
 *    absolute path outside the library root)
 *  - 60 s spawn timeout and 64 MiB stdout/stderr cap, enforced by
 *    `@alejandria/sidecar.spawnSidecar`
 *
 * The spawn step is injected via `SidecarSpawnFn` so tests run
 * without Python. Each test configures a `libraryRoot` so the path
 * sanitization is satisfiable in the tmp dir.
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
      const result = await scanFile('cortazar/rayuela.epub', {
        spawn,
        libraryRoot: tmpDir,
      })

      // Spawn must target the PR1 sidecar with the file path as the
      // single positional arg.
      expect(captured).not.toBeNull()
      expect(captured!.command).toBe('python')
      expect(captured!.args).toEqual(['-m', 'alejandria_sidecar', 'extract', 'cortazar/rayuela.epub'])

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
        filePath: 'cortazar/rayuela.epub',
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
      scanFile('missing.epub', { spawn, libraryRoot: tmpDir }),
    ).rejects.toThrow(/NOT_IMPLEMENTED/)
  })

  it('throws when the sidecar exits with a non-zero code and no JSON', async () => {
    const spawn: SidecarSpawnFn = async () => ({
      exitCode: 5,
      stdout: '',
      stderr: 'file unreadable',
    })

    await expect(
      scanFile('broken.epub', { spawn, libraryRoot: tmpDir }),
    ).rejects.toThrow(/code 5/)
  })

  it('detects unsupported extensions before spawning', async () => {
    let called = false
    const spawn: SidecarSpawnFn = async () => {
      called = true
      return { exitCode: 0, stdout: '', stderr: '' }
    }

    await expect(
      scanFile('mystery.xyz', { spawn, libraryRoot: tmpDir }),
    ).rejects.toThrow(/unsupported/i)

    expect(called).toBe(false)
  })
})

/**
 * Path sanitization (PR-3-fix-B, issue #60). The shared helper
 * rejects empty / `-`-prefixed / `..`-escaping inputs and any
 * absolute path outside the configured `libraryRoot`. The web
 * pipeline MUST apply the same hardening as the NAS-side
 * processor.
 */
describe('scan pipeline — path sanitization (#60)', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'alejandria-scan-'))
    process.env['ALEJANDRIA_DATA_DIR'] = tmpDir
  })

  afterEach(() => {
    delete process.env['ALEJANDRIA_DATA_DIR']
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('rejects a path starting with `-` (argv injection) before spawning', async () => {
    let called = false
    const spawn: SidecarSpawnFn = async () => {
      called = true
      return { exitCode: 0, stdout: '', stderr: '' }
    }
    await expect(
      scanFile('-c', { spawn, libraryRoot: tmpDir }),
    ).rejects.toThrow(/INVALID_PATH|may not start with '-'/)
    expect(called).toBe(false)
  })

  it('rejects an absolute path that escapes the library root', async () => {
    let called = false
    const spawn: SidecarSpawnFn = async () => {
      called = true
      return { exitCode: 0, stdout: '', stderr: '' }
    }
    await expect(
      scanFile('/etc/passwd', { spawn, libraryRoot: tmpDir }),
    ).rejects.toThrow(/INVALID_PATH|escapes library root/)
    expect(called).toBe(false)
  })

  it('rejects a `..`-escaping relative path', async () => {
    let called = false
    const spawn: SidecarSpawnFn = async () => {
      called = true
      return { exitCode: 0, stdout: '', stderr: '' }
    }
    await expect(
      scanFile('../etc/passwd.epub', { spawn, libraryRoot: tmpDir }),
    ).rejects.toThrow(/INVALID_PATH|escapes library root/)
    expect(called).toBe(false)
  })
})