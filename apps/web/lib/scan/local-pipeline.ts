import { spawn as nodeSpawn } from 'node:child_process'
import { extname } from 'node:path'

import { openLocalDb, type BookInput, type BookRow } from '../db/local-db'

/**
 * Local scan pipeline (PR-3B).
 *
 * Bridges the PR1 Python sidecar (`python -m alejandria_sidecar
 * extract <path>`) into the local SQLite. The sidecar is responsible
 * for extracting metadata from PDF/EPUB/DOCX/etc.; this module is
 * responsible for:
 *
 *  1. Extension whitelist (anything else is rejected before spawn)
 *  2. Spawning the sidecar as a child process
 *  3. Parsing the versioned JSON envelope from stdout
 *  4. Persisting the parsed metadata via `openLocalDb().insertBook()`
 *
 * The spawn step is parameterised via `SidecarSpawnFn` so the
 * pipeline is unit-testable without Python or `node:child_process`.
 */

export interface SpawnResult {
  exitCode: number
  stdout: string
  stderr: string
}

export type SidecarSpawnFn = (
  command: string,
  args: readonly string[],
) => Promise<SpawnResult>

/** Default spawn — invokes the real Python sidecar. */
export const defaultSpawn: SidecarSpawnFn = (command, args) =>
  new Promise<SpawnResult>((resolve, reject) => {
    const child = nodeSpawn(command, [...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.once('error', reject)
    child.once('close', (code) => {
      resolve({
        exitCode: code ?? -1,
        stdout,
        stderr,
      })
    })
  })

/**
 * Extensions the PR1 sidecar knows how to extract. Mirrors the
 * dispatch table in `services/extractors-py/alejandria_sidecar/cli.py`.
 * Anything not in this set is rejected before spawn so the user gets
 * a clear error instead of a Python traceback.
 */
const SUPPORTED_EXTENSIONS = new Set<string>([
  '.pdf',
  '.epub',
  '.docx',
  '.doc',
  '.chm',
  '.djvu',
  '.djv',
  '.cbz',
  '.cbr',
  '.mobi',
  '.azw',
  '.azw3',
  '.fb2',
  '.rtf',
  '.txt',
  '.mp3',
  '.m4a',
  '.flac',
  '.ogg',
  '.mp4',
  '.mkv',
  '.avi',
])

interface SidecarError {
  code: string
  message: string
}

interface SidecarBookResult {
  book_id: string
  title: string
  author: string
  year: number
  format: string
  content_hash: string
  excerpt: string
}

interface SidecarSuccessEnvelope {
  schema_version: number
  result: SidecarBookResult
}

interface SidecarErrorEnvelope {
  schema_version: number
  error: SidecarError
}

type SidecarEnvelope = SidecarSuccessEnvelope | SidecarErrorEnvelope

function isSidecarEnvelope(value: unknown): value is SidecarEnvelope {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v['schema_version'] === 'number' &&
    ('result' in v || 'error' in v)
  )
}

export interface ScanOptions {
  /** Override the spawn function (used by tests). */
  spawn?: SidecarSpawnFn
  /** Override the DB opener (used by tests). */
  openDb?: typeof openLocalDb
}

/**
 * Scan a single file through the PR1 sidecar and persist the
 * resulting metadata to the local DB.
 *
 * Returns the row that was inserted so callers can navigate to it.
 */
export async function scanFile(filePath: string, options: ScanOptions = {}): Promise<BookRow> {
  const ext = extname(filePath).toLowerCase()
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw new Error(`unsupported file extension: ${ext || '(none)'}`)
  }

  const spawn = options.spawn ?? defaultSpawn
  const openDb = options.openDb ?? openLocalDb

  const result = await spawn('python', ['-m', 'alejandria_sidecar', 'extract', filePath])

  if (result.exitCode !== 0 && result.stdout.trim().length === 0) {
    throw new Error(
      `sidecar exited with code ${result.exitCode}: ${result.stderr.trim() || 'no output'}`,
    )
  }

  let envelope: unknown
  try {
    envelope = JSON.parse(result.stdout.trim())
  } catch (err) {
    throw new Error(
      `sidecar produced invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  if (!isSidecarEnvelope(envelope)) {
    throw new Error('sidecar envelope is missing schema_version/result|error keys')
  }

  if (envelope.schema_version !== 1) {
    throw new Error(`unsupported schema_version: ${envelope.schema_version}`)
  }

  if ('error' in envelope) {
    throw new Error(
      `sidecar error ${envelope.error.code}: ${envelope.error.message}`,
    )
  }

  const book = envelope.result
  const input: BookInput = {
    id: book.book_id,
    title: book.title,
    author: book.author,
    year: book.year,
    format: book.format,
    filePath,
    contentHash: book.content_hash,
    excerpt: book.excerpt ?? '',
  }

  const db = openDb()
  try {
    return db.insertBook(input)
  } finally {
    db.close()
  }
}
