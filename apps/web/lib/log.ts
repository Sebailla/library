/**
 * Structured logger for the web app (PR-3-fix-C, issue #61).
 *
 * The web app ships zero observability. This module introduces
 * a tiny JSON logger so every catch block can emit a structured
 * record. The same module drives `/livez` and `/readyz` (see
 * `lib/health/sqlite-quick-check.ts`) and the request-ID
 * middleware (`lib/middleware/request-id.ts`).
 *
 * Design choices:
 *
 *  - **Pure formatter.** `formatLog(record, pretty)` is a pure
 *    function — easy to unit test and to render in any
 *    downstream log pipeline.
 *  - **Writer injection.** Production wires
 *    `(record) => console.log(...)`; tests inject an array
 *    push. This avoids monkey-patching `console.log` (which
 *    is shared with React Testing Library + jsdom and would
 *    pollute test output).
 *  - **Async-safe request ID.** A module-local `requestId`
 *    variable lets a request-scoped middleware set the id
 *    for the rest of the request lifetime. RSC + Server
 *    Actions are single-threaded so a plain variable is safe.
 *  - **Level gating.** `info` < `warn` < `error`. `info` and
 *    `warn` go to stdout, `error` to stderr. The default
 *    writer routes them via `console.log`/`console.warn`/
 *    `console.error`.
 *
 * The exported surface is intentionally small: three functions
 * (`info`, `warn`, `logError`) and two setters
 * (`setRequestId`, `clearRequestId`). Callers should NOT
 * import the writer seam in production code.
 */

export type LogLevel = 'info' | 'warn' | 'error'

/** A single log entry. */
export interface LogRecord {
  /** ISO-8601 timestamp. */
  timestamp: string
  level: LogLevel
  /** Subsystem emitting the log (e.g. `scan`, `download`, `db`). */
  scope: string
  /** Human-readable message. */
  message: string
  /** Optional request ID propagated by the middleware. */
  requestId?: string
  /** Optional structured context (key/value). */
  context?: Record<string, unknown>
  /** Captured error envelope (`logError` only). */
  error?: { name: string; message: string; stack?: string }
}

/** Sink for emitted records. Defaults to `console.*`. */
export type LogWriter = (record: LogRecord) => void

/**
 * Format a record as either a JSON line (production) or a
 * pretty single-line format (dev / test).
 */
export function formatLog(record: LogRecord, pretty: boolean): string {
  if (pretty) {
    return formatPretty(record)
  }
  return JSON.stringify(record)
}

function formatPretty(record: LogRecord): string {
  const parts: string[] = []
  parts.push(`[${record.level.toUpperCase()}]`)
  parts.push(record.scope)
  parts.push(`- ${record.message}`)
  if (record.requestId) parts.push(`(req=${record.requestId})`)
  if (record.context && Object.keys(record.context).length > 0) {
    parts.push(JSON.stringify(record.context))
  }
  if (record.error) {
    parts.push(`:: ${record.error.name}: ${record.error.message}`)
    if (record.error.stack) {
      const firstFrame = record.error.stack.split('\n')[1] ?? ''
      if (firstFrame) parts.push(firstFrame.trim())
    }
  }
  return parts.join(' ')
}

let currentRequestId: string | null = null

/** Attach a request ID to subsequent records. */
export function setRequestId(requestId: string | null | undefined): void {
  currentRequestId = requestId && requestId.length > 0 ? requestId : null
}

/** Clear the attached request ID. */
export function clearRequestId(): void {
  currentRequestId = null
}

let writer: LogWriter = defaultWriter

/**
 * Override the writer (used by tests). Production code should
 * NOT call this.
 */
export function setWriter(next: LogWriter): void {
  writer = next
}

/** Restore the default `console.*` writer. */
export function resetWriter(): void {
  writer = defaultWriter
}

function defaultWriter(record: LogRecord): void {
  const line = formatLog(record, isDev())
  if (record.level === 'error') {
    console.error(line)
  } else if (record.level === 'warn') {
    console.warn(line)
  } else {
    console.log(line)
  }
}

function isDev(): boolean {
  return process.env['NODE_ENV'] !== 'production'
}

function makeRecord(
  level: LogLevel,
  scope: string,
  message: string,
  context?: Record<string, unknown>,
  error?: LogRecord['error'],
): LogRecord {
  const record: LogRecord = {
    timestamp: new Date().toISOString(),
    level,
    scope,
    message,
  }
  if (currentRequestId) record.requestId = currentRequestId
  if (context && Object.keys(context).length > 0) record.context = context
  if (error) record.error = error
  return record
}

/** Emit an info-level record. */
export function info(
  scope: string,
  message: string,
  context?: Record<string, unknown>,
): void {
  writer(makeRecord('info', scope, message, context))
}

/** Emit a warn-level record. */
export function warn(
  scope: string,
  message: string,
  context?: Record<string, unknown>,
): void {
  writer(makeRecord('warn', scope, message, context))
}

/** Emit an error-level record with a captured error envelope. */
export function logError(
  scope: string,
  err: unknown,
  context?: Record<string, unknown>,
): void {
  const envelope = captureError(err)
  writer(makeRecord('error', scope, errorMessage(err), context, envelope))
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  if (err === undefined || err === null) return 'unknown error'
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

/**
 * Coerce arbitrary `unknown` thrown values into a structured
 * error envelope. `Error` instances keep their stack; strings
 * and primitives are wrapped as `NonError`; `undefined` /
 * `null` produce a stub.
 */
export function captureError(err: unknown): LogRecord['error'] {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack }
  }
  if (typeof err === 'string') {
    return { name: 'NonError', message: err }
  }
  if (err === undefined || err === null) {
    return { name: 'NonError', message: String(err) }
  }
  // Plain object / number / boolean — stringify so the record
  // is searchable.
  return { name: 'NonError', message: errorMessage(err) }
}