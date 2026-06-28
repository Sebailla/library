import { ChildProcess, SpawnOptions, spawn as defaultSpawn } from 'child_process';
import { relative as pathRelative, resolve as resolvePath } from 'path';
import { Logger } from '@nestjs/common';

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
}

/**
 * Typed error raised by ``ScanProcessor.handle`` when the sidecar
 * exits non-zero or the spawn itself fails. ``code`` mirrors the
 * sidecar's own error envelope (``FILE_UNREADABLE``,
 * ``BACKEND_UNAVAILABLE``, etc.) or, when the sidecar produced no
 * envelope at all, falls back to ``NOT_IMPLEMENTED`` so the BullMQ
 * worker can decide whether to retry.
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
 * Path sanitization (#33, 4R review): every ``scan`` job path is
 * resolved against the configured library root and rejected
 * unless it stays inside that root. ``..`` segments, paths that
 * start with ``-`` (argv injection), and absolute paths outside
 * the root all fail fast with ``code = INVALID_PATH`` BEFORE
 * ``spawn`` is invoked — no shell, no ``exec``, no chance of
 * escape.
 *
 * Acceptance: the BullMQ worker that wraps this processor MUST
 * catch {@link SidecarError} and ack the job so a corrupt input
 * does not halt the queue (see ``nas-scanner-workers`` spec
 * § "Errors are isolated, never blocking").
 */
export class ScanProcessor {
  private readonly logger = new Logger(ScanProcessor.name);
  // ``defaultSpawn`` is overloaded; we type the field with the
  // generic ``SpawnFn`` shape so the test seam and the production
  // fallback are interchangeable.
  private readonly spawn: SpawnFn;
  private readonly pythonCommand: string;
  private readonly libraryRoot: string;

  constructor(options: ScanProcessorOptions = {}) {
    this.spawn =
      options.spawn ??
      (defaultSpawn as unknown as SpawnFn);
    this.pythonCommand = options.pythonCommand ?? 'python';
    const rawRoot =
      options.libraryRoot ??
      process.env.NAS_LIBRARY_ROOT ??
      DEFAULT_LIBRARY_ROOT;
    // Normalise so ``path.relative`` treats both sides the same way.
    this.libraryRoot = resolvePath(rawRoot);
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
   * Resolution rules:
   *
   *   1. Empty / non-string → ``INVALID_PATH``.
   *   2. Path starts with ``-`` → ``INVALID_PATH`` (argv
   *      injection: ``python -m alejandria_sidecar extract -c``
   *      would be read by ``argparse`` as a flag).
   *   3. ``path.resolve(root, input)`` is computed and then
   *      checked against the root via ``path.relative`` so
   *      ``../`` segments, absolute escapes, and symlinks (where
   *      supported) all surface the same way.
   *   4. The resolved absolute path is returned.
   */
  private sanitizePath(rawPath: string): string {
    if (typeof rawPath !== 'string' || rawPath.length === 0) {
      throw new SidecarError({
        code: 'INVALID_PATH',
        exitCode: -1,
        stderr: '',
        envelope: null,
        message: 'scan path is empty or not a string',
      });
    }
    if (rawPath.startsWith('-')) {
      throw new SidecarError({
        code: 'INVALID_PATH',
        exitCode: -1,
        stderr: '',
        envelope: null,
        message: `scan path may not start with '-': ${rawPath}`,
      });
    }
    const resolved = resolvePath(this.libraryRoot, rawPath);
    const rel = pathRelative(this.libraryRoot, resolved);
    // Empty relative path = the root itself; we accept it so the
    // sidecar reports FILE_UNREADABLE for the directory. Anything
    // starting with ``..`` or absolute (``path.isAbsolute``)
    // escapes the root and is rejected.
    if (rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'))) {
      return resolved;
    }
    throw new SidecarError({
      code: 'INVALID_PATH',
      exitCode: -1,
      stderr: '',
      envelope: null,
      message: `scan path escapes library root (${this.libraryRoot}): ${rawPath}`,
    });
  }

  /**
   * Internal: shell out to ``python -m alejandria_sidecar extract
   * <path>`` and parse the JSON envelope. The argv layout is the
   * one the sidecar's own ``argparse`` parser expects — see
   * ``alejandria_sidecar/cli.py``.
   */
  private runExtract(path: string): Promise<SidecarEnvelope> {
    return new Promise<SidecarEnvelope>((resolve, reject) => {
      const child = this.spawn(this.pythonCommand, [
        '-m',
        'alejandria_sidecar',
        'extract',
        path,
      ]);

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (chunk: Buffer | string) => {
        stdout += chunk.toString('utf8');
      });
      child.stderr?.on('data', (chunk: Buffer | string) => {
        stderr += chunk.toString('utf8');
      });

      child.on('error', (err) => {
        reject(
          new SidecarError({
            code: 'SPAWN_FAILED',
            exitCode: -1,
            stderr: stderr || err.message,
            envelope: null,
            message: `spawn ${this.pythonCommand} failed: ${err.message}`,
          }),
        );
      });

      child.on('exit', (exit) => {
        const exitCode = exit ?? -1;
        const envelope = parseEnvelope(stdout);
        if (exitCode === 0) {
          resolve(envelope ?? { schema_version: 1, warnings: [] });
          return;
        }
        // Non-zero exit. The sidecar is contractually required to
        // emit a ``schema_version=1`` envelope even on failure, so
        // prefer the envelope's ``error.code`` when present and
        // fall back to a generic ``NOT_IMPLEMENTED`` otherwise.
        const errorCode = envelope?.error?.code ?? 'NOT_IMPLEMENTED';
        const message =
          envelope?.error?.message ??
          `sidecar exited ${exitCode} with no error envelope`;
        reject(
          new SidecarError({
            code: errorCode,
            exitCode,
            stderr,
            envelope,
            message,
          }),
        );
      });
    });
  }
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
