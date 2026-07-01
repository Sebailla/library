import { ChildProcess, SpawnOptions, spawn as defaultSpawn } from 'child_process';
import { resolve as resolvePath } from 'path';
import { Logger } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import {
  sanitizePath as sharedSanitizePath,
  spawnSidecar as sharedSpawnSidecar,
  SidecarError as SharedSidecarError,
  MAX_OUTPUT_BYTES,
  SPAWN_TIMEOUT_MS,
  type SpawnSidecarImpl,
} from '../sidecar';

/**
 * JSON envelope every ``alejandria-sidecar`` invocation emits on
 * stdout. The shape is documented in
 * ``openspec/changes/alejandria-v2/specs/python-sidecar-cli/spec.md``
 * and the in-tree ``alejandria_sidecar.cli`` module.
 *
 * The fields here are the union of what the wrapper modules
 * (``pdf``, ``epub``, ``image``, ``audio``, ``video``, …) are
 * allowed to emit. Optional fields may be missing or ``null`` on a
 * particular run — the contract says the wrapper MUST always emit
 * ``schema_version`` + ``format`` (or a top-level ``error`` object),
 * but downstream consumers (this processor) should treat any extra
 * keys as opaque and pass them through unchanged.
 */
export interface SidecarEnvelope {
  schema_version: number;
  format?: string;
  path?: string;
  title?: string | null;
  author?: string | null;
  extractor_name?: string;
  warnings?: string[];
  text?: string;
  confidence?: number;
  backend?: string;
  lang?: string;
  error?: { code: string; message: string };
}

/** Job payload consumed by ``ScanProcessor.handle``. */
export interface ScanJob {
  path: string;
  /** Optional SHA-256 hint (used for the idempotent re-scan path). */
  sha256_hint?: string;
}

/**
 * Type of the spawn function the processor uses (test seam). The
 * signature mirrors ``child_process.spawn``'s default overload
 * (no ``stdio`` => ``ChildProcess``) so the test fake is type-
 * compatible with the real implementation. The internal field
 * is typed as ``typeof defaultSpawn`` to absorb the real
 * ``spawn`` function's overload set; the public test seam stays
 * the focused 3-argument shape.
 */
export type SpawnFn = (
  command: string,
  args: readonly string[],
  options?: SpawnOptions,
) => ChildProcess;

/** Options accepted by the ``ScanProcessor`` constructor. */
export interface ScanProcessorOptions {
  /**
   * Override the spawn implementation. Defaults to
   * ``child_process.spawn``. The tests inject a fake; production
   * wiring leaves this undefined.
   */
  spawn?: SpawnFn;
  /**
   * Override the Python interpreter command. Defaults to
   * ``"python"``; useful in CI where the binary is ``python3`` or a
   * pinned venv interpreter.
   */
  pythonCommand?: string;
  /**
   * Override the library root used for path sanitization.
   * Defaults to ``process.env.NAS_LIBRARY_ROOT`` and finally to
   * ``"/share/biblioteca/raw/"``. Every accepted scan path is
   * resolved against this root and MUST stay inside it; paths
   * that escape are rejected with ``SidecarError`` (code
   * ``INVALID_PATH``) so they never reach ``spawn``.
   */
  libraryRoot?: string;
  /**
   * Override the maximum number of bytes the processor will
   * accumulate from a single stream before killing the child
   * (4R review #45). Defaults to {@link MAX_OUTPUT_BYTES}
   * (64 MB). Tests lower this to a small value so the suite
   * does not allocate 64 MB of fake stdout.
   */
  maxOutputBytes?: number;
  /**
   * Override the spawn wall-clock timeout (4R review #45).
   * Defaults to {@link SPAWN_TIMEOUT_MS} (60 s). Tests lower
   * this to a small value so the suite does not have to wait
   * the full 60 s for a hung-child assertion.
   */
  spawnTimeoutMs?: number;
}

/**
 * Typed error raised by ``ScanProcessor.handle`` when the sidecar
 * exits non-zero or the spawn itself fails. ``code`` mirrors the
 * sidecar's own error envelope (``FILE_UNREADABLE``,
 * ``BACKEND_UNAVAILABLE``, etc.) or, when the sidecar produced no
 * envelope at all, falls back to ``NOT_IMPLEMENTED`` so the BullMQ
 * worker can decide whether to retry.
 *
 * PR-3-fix-B: the processor delegates path sanitization and the
 * spawn-with-cap contract to ``@alejandria/sidecar``. The shared
 * ``SidecarError`` is translated into THIS local ``SidecarError``
 * so the existing public surface (with the ``envelope`` field)
 * stays stable.
 */
export class SidecarError extends Error {
  readonly code: string;
  readonly exitCode: number;
  readonly stderr: string;
  readonly envelope: SidecarEnvelope | null;

  constructor(args: {
    code: string;
    exitCode: number;
    stderr: string;
    envelope: SidecarEnvelope | null;
    message?: string;
  }) {
    super(
      args.message ??
        `sidecar exited with code ${args.exitCode} (${args.code}): ${args.stderr.trim() || '<no stderr>'}`,
    );
    this.name = 'SidecarError';
    this.code = args.code;
    this.exitCode = args.exitCode;
    this.stderr = args.stderr;
    this.envelope = args.envelope;
  }
}

/**
 * Default library root. Used when ``NAS_LIBRARY_ROOT`` is unset
 * AND ``ScanProcessorOptions.libraryRoot`` is not provided. The
 * trailing slash matters: ``path.relative`` treats one root as
 * a prefix of the other, so we normalise both sides.
 */
const DEFAULT_LIBRARY_ROOT = '/share/biblioteca/raw/';

// Re-exported for callers that imported these from the processor
// before PR-3-fix-B.
export { MAX_OUTPUT_BYTES, SPAWN_TIMEOUT_MS };

/**
 * Scan processor — the BullMQ-side half of the
 * ``alejandria-sidecar`` boundary. Owns spawning the sidecar CLI,
 * collecting its JSON envelope, and surfacing typed errors when
 * the process exits non-zero.
 *
 * The processor does NOT talk to Postgres directly. A separate
 * (future) ``books.upsertFromScan`` collaborator will read the
 * returned envelope and write to ``books`` /
 * ``book_categories``. Splitting spawn from persistence keeps the
 * unit test in this commit honest — there is no DB to mock, and
 * the spawn contract is pinned by ``test/workers/scan.processor
 * .spec.ts`` in isolation.
 *
 * Path sanitization (#33, 4R review, PR-3-fix-B #60): every
 * ``scan`` job path is delegated to
 * ``@alejandria/sidecar.sanitizePath`` — the shared helper
 * rejects ``..`` segments, paths that start with ``-`` (argv
 * injection), and absolute paths outside the root, all with
 * ``code = INVALID_PATH`` BEFORE ``spawn`` is invoked. No shell,
 * no ``exec``, no chance of escape.
 *
 * Acceptance: the BullMQ worker that wraps this processor MUST
 * catch {@link SidecarError} and ack the job so a corrupt input
 * does not halt the queue (see ``nas-scanner-workers`` spec
 * § "Errors are isolated, never blocking").
 */
export class ScanProcessor {
  private readonly logger = new Logger(ScanProcessor.name);
  private readonly spawn: SpawnSidecarImpl;
  private readonly pythonCommand: string;
  private readonly libraryRoot: string;
  /** Per-stream stdout/stderr byte cap (4R review #45). */
  readonly maxOutputBytes: number;
  /** Wall-clock timeout for a single spawn (4R review #45). */
  readonly timeoutMs: number;

  constructor(options: ScanProcessorOptions = {}) {
    this.spawn =
      (options.spawn as unknown as SpawnSidecarImpl) ??
      (defaultSpawn as unknown as SpawnSidecarImpl);
    this.pythonCommand = options.pythonCommand ?? 'python';
    const rawRoot =
      options.libraryRoot ??
      process.env.NAS_LIBRARY_ROOT ??
      DEFAULT_LIBRARY_ROOT;
    // Normalise so ``path.relative`` treats both sides the same way.
    this.libraryRoot = resolvePath(rawRoot);
    this.maxOutputBytes = options.maxOutputBytes ?? MAX_OUTPUT_BYTES;
    this.timeoutMs = options.spawnTimeoutMs ?? SPAWN_TIMEOUT_MS;
  }

  /**
   * Process a single ``scan`` job. Returns the parsed envelope on
   * success; rejects with {@link SidecarError} on any non-zero exit
   * or spawn failure.
   */
  async handle(job: ScanJob): Promise<SidecarEnvelope> {
    const safePath = this.sanitizePath(job.path);
    return this.runExtract(safePath);
  }

  /**
   * Resolve and validate the scan path against the configured
   * library root. Throws {@link SidecarError} with
   * ``code = 'INVALID_PATH'`` for any input that would escape the
   * root, inject argv flags, or fail to resolve.
   *
   * PR-3-fix-B: delegates to ``@alejandria/sidecar.sanitizePath``
   * so the web-side and the NAS-side apply the same hardening.
   */
  private sanitizePath(rawPath: string): string {
    try {
      return sharedSanitizePath(rawPath, { libraryRoot: this.libraryRoot });
    } catch (err) {
      throw translateSharedError(err, { envelope: null });
    }
  }

  /**
   * Internal: shell out to ``python -m alejandria_sidecar extract
   * <path>`` and parse the JSON envelope. The argv layout is the
   * one the sidecar's own ``argparse`` parser expects — see
   * ``alejandria_sidecar/cli.py``.
   *
   * 4R review #45: the spawn is bounded by two walls, both now
   * enforced by ``@alejandria/sidecar.spawnSidecar``:
   *
   *   - ``this.maxOutputBytes`` (default 64 MB) — once a stream
   *     accumulates that many bytes we SIGKILL the child and
   *     reject with a {@link SidecarError} whose ``code`` is
   *     ``OUTPUT_OVERFLOW``. BullMQ sees an UnrecoverableError
   *     and skips remaining retries.
   *   - ``this.timeoutMs`` (default 60 s) — a setTimeout kills
   *     the child on a hung interpreter. Same outcome: the
   *     rejection is translated to UnrecoverableError.
   *
   * Failure routing (mirrors the pre-PR-3-fix-B contract so the
   * existing ``test/workers/scan.processor.spec.ts`` keeps
   * passing):
   *
   *   - Cap-related failures (``SPAWN_TIMEOUT``,
   *     ``OUTPUT_OVERFLOW``) → ``UnrecoverableError`` wrapping
   *     the {@link SidecarError} message (a misbehaving CLI is
   *     not going to recover on retry).
   *   - Spawn-time failures (``SPAWN_FAILED``) and non-zero exits
   *     → bare {@link SidecarError}.
   */
  private async runExtract(path: string): Promise<SidecarEnvelope> {
    const argv = ['-m', 'alejandria_sidecar', 'extract', path];
    let result;
    try {
      result = await sharedSpawnSidecar(
        [this.pythonCommand, ...argv],
        {
          spawn: this.spawn,
          timeoutMs: this.timeoutMs,
          maxOutputBytes: this.maxOutputBytes,
        },
      );
    } catch (err) {
      if (err instanceof SharedSidecarError) {
        const code = err.code
        if (code === 'SPAWN_TIMEOUT' || code === 'OUTPUT_OVERFLOW') {
          throw new UnrecoverableError(
            new SidecarError({
              code,
              exitCode: -1,
              stderr: err.stderr,
              envelope: null,
              message: err.message,
            }).message,
          )
        }
        if (code === 'SPAWN_FAILED') {
          throw new SidecarError({
            code,
            exitCode: -1,
            stderr: err.stderr,
            envelope: null,
            message: err.message,
          })
        }
        // INVALID_PATH (raised by spawnSidecar on empty argv) or
        // anything else from the shared module — propagate as a
        // local SidecarError.
        throw new SidecarError({
          code,
          exitCode: err.exitCode,
          stderr: err.stderr,
          envelope: null,
          message: err.message,
        })
      }
      throw err
    }
    const envelope = parseEnvelope(result.stdout);
    if (result.exitCode === 0) {
      return envelope ?? { schema_version: 1, warnings: [] };
    }
    // Non-zero exit. The sidecar is contractually required to
    // emit a ``schema_version=1`` envelope even on failure, so
    // prefer the envelope's ``error.code`` when present and
    // fall back to a generic ``NOT_IMPLEMENTED`` otherwise.
    const errorCode = envelope?.error?.code ?? 'NOT_IMPLEMENTED';
    const message =
      envelope?.error?.message ??
      `sidecar exited ${result.exitCode} with no error envelope`;
    throw new SidecarError({
      code: errorCode,
      exitCode: result.exitCode,
      stderr: result.stderr,
      envelope,
      message,
    });
  }
}

/**
 * Translate a ``@alejandria/sidecar`` ``SidecarError`` (or any
 * other thrown value) into the local ``SidecarError`` that
 * ``ScanProcessor`` has always exposed. ``envelope`` is
 * ``null`` on the way in — the local ``SidecarError`` is the
 * only carrier of an envelope (after the spawn returns and we
 * parse stdout).
 */
function translateSharedError(
  err: unknown,
  meta: { envelope: SidecarEnvelope | null },
): SidecarError {
  if (err instanceof SharedSidecarError) {
    return new SidecarError({
      code: err.code,
      exitCode: err.exitCode,
      stderr: err.stderr,
      envelope: meta.envelope,
      message: err.message,
    });
  }
  return new SidecarError({
    code: 'NOT_IMPLEMENTED',
    exitCode: -1,
    stderr: err instanceof Error ? err.message : String(err),
    envelope: meta.envelope,
    message: err instanceof Error ? err.message : String(err),
  });
}

/**
 * Parse the first non-empty line of ``stdout`` as a JSON envelope.
 * Returns ``null`` when the output is empty or unparseable — the
 * caller (always ``ScanProcessor.runExtract``) decides whether
 * that warrants a failure.
 */
function parseEnvelope(stdout: string): SidecarEnvelope | null {
  const text = stdout.trim();
  if (!text) return null;
  // The CLI guarantees one JSON object per invocation; if a
  // future version emits multiple we still want the FIRST one
  // because that's where ``schema_version`` lives.
  const firstLine = text.split('\n', 1)[0];
  try {
    const parsed = JSON.parse(firstLine) as SidecarEnvelope;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof parsed.schema_version === 'number'
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}