import {
  sanitizePath,
  spawnSidecar,
  SPAWN_TIMEOUT_MS,
  MAX_OUTPUT_BYTES,
  SidecarError as SharedSidecarError,
  type SpawnSidecarImpl,
} from '@alejandria/sidecar'
import { extname } from 'node:path'

import { openLocalDb, type BookInput, type BookRow } from '../db/local-db'

/**
 * Local scan pipeline (PR-3B + PR-3-fix-B hardening).
 *
 * Bridges the PR1 Python sidecar (`python -m alejandria_sidecar
 * extract <path>`) into the local SQLite. The sidecar is
 * responsible for extracting metadata from PDF/EPUB/DOCX/etc.;
 * this module is responsible for:
 *
 *  1. Extension whitelist (anything else is rejected before spawn)
 *  2. Path sanitization via `@alejandria/sidecar.sanitizePath` —
 *     rejects empty / `-`-prefixed / `..`-escaping inputs and any
 *     absolute path outside `libraryRoot` (#60, BLOCKER).
 *  3. Spawning the sidecar via `@alejandria/sidecar.spawnSidecar` —
 *     enforces `SPAWN_TIMEOUT_MS` (60 s) and
 *     `MAX_OUTPUT_BYTES` (64 MiB) on stdout+stderr.
 *  4. Parsing the versioned JSON envelope from stdout.
 *  5. Persisting the parsed metadata via `openLocalDb().insertBook()`.
 *
 * Before PR-3-fix-B the web-side `defaultSpawn` reimplemented spawn
 * without the PR-2E hardening — issue #60 reopened argv injection,
 * unbounded stdout, and hung-Python interpreter failure modes. After
 * the fix both this module and
 * `services/nas-backend/src/workers/scan.processor.ts` consume the
 * exact same `@alejandria/sidecar` helpers.
 *
 * The spawn step is parameterised via {@link SidecarSpawnFn} so the
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

/**
 * Default spawn — delegates to the shared `@alejandria/sidecar`
 * helper so the same 60 s / 64 MiB caps apply whether the user
 * supplied a `spawn` override or not.
 */
export const defaultSpawn: SidecarSpawnFn = async (command, args) => {
  const result = await spawnSidecar([command, ...args])
  return {
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  }
}

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
  error: { code: string; message: string }
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
  /**
   * Library root used by `@alejandria/sidecar.sanitizePath`. The
   * input path MUST resolve to a path inside this root. Defaults
   * to `process.env.ALEJANDRIA_WEB_LIBRARY_ROOT` and finally to
   * `<cwd>/apps/web/data/library/` (the convention the web app
   * uses for local scans).
   */
  libraryRoot?: string
  /**
   * Override the spawn implementation consumed by the shared
   * helper (used by tests that drive the underlying `spawn`).
   * Only consulted when `spawn` (the legacy `SidecarSpawnFn`
   * seam) is NOT provided.
   */
  sharedSpawn?: SpawnSidecarImpl
}

/**
 * Scan a single file through the PR1 sidecar and persist the
 * resulting metadata to the local DB.
 *
 * Returns the row that was inserted so callers can navigate to it.
 *
 * PR-3-fix-B: the input is sanitized via
 * `@alejandria/sidecar.sanitizePath` BEFORE the extension
 * whitelist so an attacker-controlled path can never reach the
 * Python sidecar. The shared helper rejects empty / `-` /
 * `..` / outside-root inputs with `SidecarError(code='INVALID_PATH')`.
 */
export async function scanFile(filePath: string, options: ScanOptions = {}): Promise<BookRow> {
  const libraryRoot =
    options.libraryRoot ??
    process.env['ALEJANDRIA_WEB_LIBRARY_ROOT'] ??
    defaultLibraryRoot()
  // Path sanitization runs FIRST so an attacker cannot probe the
  // extension whitelist with arbitrary argv-injection vectors.
  // The shared helper throws `SidecarError(INVALID_PATH)` for
  // any rejected input.
  sanitizePath(filePath, { libraryRoot })

  const ext = extname(filePath).toLowerCase()
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw new Error(`unsupported file extension: ${ext || '(none)'}`)
  }

  const spawn = options.spawn ?? defaultSpawn

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

  const openDb = options.openDb ?? openLocalDb
  const db = openDb()
  try {
    return db.insertBook(input)
  } finally {
    db.close()
  }
}

/**
 * Default library root for the web app. The trailing slash
 * matters: `path.relative` treats one root as a prefix of the
 * other, so we normalise both sides.
 */
function defaultLibraryRoot(): string {
  // The convention is the same dir the local SQLite lives in
  // (see `lib/db/local-db.ts`). PR-4 (Electron) overrides this
  // via `ALEJANDRIA_WEB_LIBRARY_ROOT`.
  const { join } = require('node:path') as typeof import('node:path')
  return join(process.cwd(), 'data', 'library')
}

// Re-export the shared caps so callers can introspect them.
export { SPAWN_TIMEOUT_MS, MAX_OUTPUT_BYTES, SharedSidecarError }