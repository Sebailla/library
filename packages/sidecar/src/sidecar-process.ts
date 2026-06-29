/**
 * Shared sidecar spawn + path sanitization (PR-3-fix-B, issue #60).
 *
 * Extracted from `services/nas-backend/src/workers/scan.processor.ts`
 * so the web scan pipeline and the BullMQ scan processor share the
 * exact same hardening.
 *
 * The helpers are deliberately tiny and dependency-free so the
 * package can be imported from both the Next.js client/server
 * boundary (`apps/web`) and the NestJS worker
 * (`services/nas-backend`) without dragging in extra runtime
 * dependencies.
 */

import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { relative as pathRelative, resolve as resolvePath } from 'node:path'

/**
 * Maximum wall-clock time a single `spawnSidecar` call is
 * allowed to run before the helper SIGKILLs the child
 * (PR-2E, 4R review #45). A hung Python interpreter MUST NOT
 * block the worker forever — the BullMQ retry budget is for
 * transient failures, not infinite hangs. 60 s mirrors the
 * value originally hard-coded in
 * `services/nas-backend/src/workers/scan.processor.ts`.
 */
export const SPAWN_TIMEOUT_MS = 60_000

/**
 * Maximum number of bytes the helper will accumulate from
 * `stdout` OR `stderr` before killing the child
 * (PR-2E, 4R review #45). The cap is enforced per-stream so a
 * misbehaving sidecar that spews only to stderr is still
 * caught. 64 MiB matches the original `MAX_OUTPUT_BYTES`
 * constant.
 */
export const MAX_OUTPUT_BYTES = 64 * 1024 * 1024

/**
 * Typed error raised by `sanitizePath` and `spawnSidecar` when
 * the input is invalid, the sidecar exits non-zero, the spawn
 * itself fails, the output overflows, or the wall-clock timeout
 * fires.
 *
 * `code` mirrors the sidecar's own error envelope
 * (`FILE_UNREADABLE`, `BACKEND_UNAVAILABLE`, …) or, when no
 * envelope was produced, one of:
 *
 *   - `INVALID_PATH` — `sanitizePath` rejected the input.
 *   - `SPAWN_TIMEOUT` — wall-clock cap fired.
 *   - `OUTPUT_OVERFLOW` — per-stream byte cap fired.
 *   - `SPAWN_FAILED` — `child.on('error')` fired (ENOENT, etc.).
 *   - `NOT_IMPLEMENTED` — non-zero exit with no error envelope.
 */
export class SidecarError extends Error {
  readonly code: string
  readonly exitCode: number
  readonly stderr: string

  constructor(args: {
    code: string
    exitCode: number
    stderr: string
    message: string
  }) {
    super(args.message)
    this.name = 'SidecarError'
    this.code = args.code
    this.exitCode = args.exitCode
    this.stderr = args.stderr
  }
}

/**
 * Options accepted by {@link sanitizePath}.
 */
export interface SanitizePathOptions {
  /**
   * Absolute path of the library root. Every accepted input is
   * resolved against this root and MUST stay inside it.
   */
  libraryRoot: string
}

/**
 * Resolve and validate a sidecar input path against the
 * configured library root.
 *
 * Rejection rules (mirror PR-2E, issue #33, 4R review #45):
 *
 *   1. Empty / non-string → `INVALID_PATH`.
 *   2. Path starts with `-` → `INVALID_PATH` (argv injection).
 *   3. `..` segments or absolute paths that escape the root →
 *      `INVALID_PATH` (path traversal).
 *
 * On success returns the resolved absolute path.
 */
export function sanitizePath(input: string, opts: SanitizePathOptions): string {
  if (typeof input !== 'string' || input.length === 0) {
    throw new SidecarError({
      code: 'INVALID_PATH',
      exitCode: -1,
      stderr: '',
      message: 'scan path is empty or not a string',
    })
  }
  if (input.startsWith('-')) {
    throw new SidecarError({
      code: 'INVALID_PATH',
      exitCode: -1,
      stderr: '',
      message: `scan path may not start with '-': ${input}`,
    })
  }
  const root = resolvePath(opts.libraryRoot)
  const resolved = resolvePath(root, input)
  const rel = pathRelative(root, resolved)
  if (rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'))) {
    return resolved
  }
  throw new SidecarError({
    code: 'INVALID_PATH',
    exitCode: -1,
    stderr: '',
    message: `scan path escapes library root (${root}): ${input}`,
  })
}

/**
 * Shape of a `child_process.spawn`-compatible function the
 * helper accepts as a test seam. The signature mirrors
 * `node:child_process.spawn` (no `stdio` => `ChildProcess`).
 */
export type SpawnSidecarImpl = (
  command: string,
  args: readonly string[],
) => ChildProcess

/**
 * Options accepted by {@link spawnSidecar}.
 */
export interface SpawnSidecarOptions {
  /** Override the spawn implementation (test seam). Defaults to `node:child_process.spawn`. */
  spawn?: SpawnSidecarImpl
  /** Wall-clock timeout in ms (default {@link SPAWN_TIMEOUT_MS}). */
  timeoutMs?: number
  /** Per-stream stdout/stderr byte cap (default {@link MAX_OUTPUT_BYTES}). */
  maxOutputBytes?: number
}

/**
 * Result returned by {@link spawnSidecar} when the child exits
 * cleanly (before any cap fires).
 */
export interface SpawnSidecarResult {
  exitCode: number
  stdout: string
  stderr: string
}

/**
 * Spawn a sidecar child process with wall-clock and per-stream
 * output caps. Returns `{ exitCode, stdout, stderr }` on clean
 * exit; rejects with a {@link SidecarError} on overflow, timeout,
 * spawn failure, or non-zero exit (no envelope parsing here — the
 * caller decides).
 *
 * This helper is the shared core both apps use to invoke the
 * Python sidecar. Callers are still responsible for any
 * pre-spawn path validation (call {@link sanitizePath} first).
 */
export function spawnSidecar(
  args: readonly string[],
  options: SpawnSidecarOptions = {},
): Promise<SpawnSidecarResult> {
  const spawnImpl = options.spawn ?? (nodeSpawn as unknown as SpawnSidecarImpl)
  const timeoutMs = options.timeoutMs ?? SPAWN_TIMEOUT_MS
  const maxOutputBytes = options.maxOutputBytes ?? MAX_OUTPUT_BYTES
  if (args.length === 0) {
    return Promise.reject(
      new SidecarError({
        code: 'INVALID_PATH',
        exitCode: -1,
        stderr: '',
        message: 'spawnSidecar requires at least one argv element',
      }),
    )
  }
  const command = args[0]!
  const rest = args.slice(1)
  return new Promise<SpawnSidecarResult>((resolve, reject) => {
    const child = spawnImpl(command, rest)
    let stdout = ''
    let stderr = ''
    let stdoutBytes = 0
    let stderrBytes = 0
    let aborted = false

    const failWith = (code: string, message: string): void => {
      if (aborted) return
      aborted = true
      clearTimeout(timer)
      try {
        child.kill('SIGKILL')
      } catch {
        /* best-effort */
      }
      reject(
        new SidecarError({
          code,
          exitCode: -1,
          stderr,
          message,
        }),
      )
    }

    child.stdout?.on('data', (chunk: Buffer | string) => {
      if (aborted) return
      const text = chunk.toString('utf8')
      stdout += text
      stdoutBytes += Buffer.byteLength(text, 'utf8')
      if (stdoutBytes > maxOutputBytes) {
        failWith(
          'OUTPUT_OVERFLOW',
          `sidecar stdout exceeded ${maxOutputBytes} bytes`,
        )
      }
    })
    child.stderr?.on('data', (chunk: Buffer | string) => {
      if (aborted) return
      const text = chunk.toString('utf8')
      stderr += text
      stderrBytes += Buffer.byteLength(text, 'utf8')
      if (stderrBytes > maxOutputBytes) {
        failWith(
          'OUTPUT_OVERFLOW',
          `sidecar stderr exceeded ${maxOutputBytes} bytes`,
        )
      }
    })

    const timer = setTimeout(() => {
      failWith(
        'SPAWN_TIMEOUT',
        `sidecar ${command} timed out after ${timeoutMs} ms`,
      )
    }, timeoutMs)
    if (typeof (timer as { unref?: () => void }).unref === 'function') {
      ;(timer as { unref: () => void }).unref()
    }

    child.on('error', (err) => {
      if (aborted) return
      aborted = true
      clearTimeout(timer)
      reject(
        new SidecarError({
          code: 'SPAWN_FAILED',
          exitCode: -1,
          stderr: stderr || err.message,
          message: `spawn ${command} failed: ${err.message}`,
        }),
      )
    })

    child.on('exit', (exit) => {
      if (aborted) return
      aborted = true
      clearTimeout(timer)
      resolve({
        exitCode: exit ?? -1,
        stdout,
        stderr,
      })
    })
  })
}