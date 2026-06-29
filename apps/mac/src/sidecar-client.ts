/**
 * Sidecar envelope contract for the `@alejandria/mac` Electron
 * shell (PR-4C, issue #75).
 *
 * The Python sidecar (`python -m alejandria_sidecar …`) is
 * shared with `apps/web` and `services/nas-backend`. The
 * versioned envelope it emits on stdout is:
 *
 *   Success: `{ schema_version: 1, result: { book_id, title, ... } }`
 *   Error:   `{ schema_version: 1, error:  { code, message } }`
 *
 * `parseSidecarEnvelope` is the boundary between the untrusted
 * string from a child process and a typed object the rest of the
 * main process can consume. It is a PURE FUNCTION: no I/O, no
 * spawning, no Node-specific APIs beyond `JSON.parse`. This
 * keeps it trivially unit-testable and reusable on both the
 * web and the NAS side (the same shape is already used in
 * `apps/web/lib/scan/local-pipeline.ts`).
 *
 * The error class mirrors the `SidecarError` from
 * `packages/sidecar/src/sidecar-process.ts` so a single
 * `code` string is enough to switch on the failure mode in the
 * IPC layer.
 */

export const SIDECAR_SCHEMA_VERSION = 1

export interface SidecarBookResult {
  book_id: string
  title: string
  author: string
  year: number
  format: string
  content_hash: string
  excerpt: string
}

export interface SidecarSuccessEnvelope {
  schema_version: number
  result: SidecarBookResult
}

export interface SidecarErrorEnvelope {
  schema_version: number
  error: { code: string; message: string }
}

type SidecarEnvelope = SidecarSuccessEnvelope | SidecarErrorEnvelope

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSuccessEnvelope(value: SidecarEnvelope): value is SidecarSuccessEnvelope {
  return 'result' in value
}

function isErrorEnvelope(value: SidecarEnvelope): value is SidecarErrorEnvelope {
  return 'error' in value
}

/**
 * Thrown by {@link parseSidecarEnvelope} when the sidecar
 * returned an error envelope. The `code` field is the same
 * string the sidecar emitted (e.g. `FILE_UNREADABLE`,
 * `BACKEND_UNAVAILABLE`) so callers can switch on it without
 * parsing the message.
 */
export class SidecarEnvelopeError extends Error {
  readonly code: string
  readonly sidecarMessage: string

  constructor(args: { code: string; message: string }) {
    super(`sidecar ${args.code}: ${args.message}`)
    this.name = 'SidecarEnvelopeError'
    this.code = args.code
    this.sidecarMessage = args.message
  }
}

export interface SidecarRequestOptions {
  payload: { type: 'extract'; localPath: string }
}

/**
 * Parse a sidecar stdout buffer into a typed result.
 *
 * Throws:
 *   - `Error` on invalid JSON.
 *   - `Error` on missing `schema_version`, missing `result|error`,
 *     or unsupported `schema_version`.
 *   - `SidecarEnvelopeError` on a sidecar error envelope.
 */
export function parseSidecarEnvelope(stdout: string): SidecarBookResult {
  const trimmed = stdout.trim()
  if (trimmed.length === 0) {
    throw new Error('sidecar envelope is empty')
  }
  let value: unknown
  try {
    value = JSON.parse(trimmed)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(`sidecar produced invalid JSON: ${detail}`)
  }
  if (!isObject(value)) {
    throw new Error('sidecar envelope is not a JSON object')
  }
  const schemaVersion = value['schema_version']
  if (typeof schemaVersion !== 'number') {
    throw new Error('sidecar envelope is missing schema_version')
  }
  if (schemaVersion !== SIDECAR_SCHEMA_VERSION) {
    throw new Error(`unsupported sidecar schema_version: ${schemaVersion}`)
  }
  if (!('result' in value) && !('error' in value)) {
    throw new Error('sidecar envelope is missing both "result" and "error" keys')
  }
  const envelope = value as unknown as SidecarEnvelope
  if (isErrorEnvelope(envelope)) {
    throw new SidecarEnvelopeError({
      code: envelope.error.code,
      message: envelope.error.message,
    })
  }
  if (isSuccessEnvelope(envelope)) {
    return {
      book_id: envelope.result.book_id,
      title: envelope.result.title,
      author: envelope.result.author,
      year: envelope.result.year,
      format: envelope.result.format,
      content_hash: envelope.result.content_hash,
      excerpt: envelope.result.excerpt ?? '',
    }
  }
  // Unreachable — the check above guarantees one of the two
  // keys is present. The throw is here purely to satisfy
  // noImplicitReturns.
  throw new Error('sidecar envelope is missing both "result" and "error" keys')
}
