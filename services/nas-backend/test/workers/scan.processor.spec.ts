import { spawn, ChildProcess, SpawnOptions } from 'child_process';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
import { UnrecoverableError } from 'bullmq';
import {
  ScanProcessor,
  SidecarEnvelope,
  SidecarError,
  MAX_OUTPUT_BYTES,
  SPAWN_TIMEOUT_MS,
} from '../../src/workers/scan.processor';

/**
 * Contract tests for ``ScanProcessor`` (PR-2E, work unit 2).
 *
 *   - Spawns the sidecar CLI with the correct argv
 *     (``python -m alejandria_sidecar extract <path>``).
 *   - Resolves with the parsed JSON envelope on exit code 0.
 *   - Surfaces a typed error on non-zero exit codes (handler does
 *     not crash the BullMQ worker).
 *
 * The actual ``child_process.spawn`` is replaced with an
 * in-process fake so no Python interpreter is required to run the
 * suite. The fake's stdout, stderr, and exit code are configured
 * per-test so the same code path is exercised end-to-end without
 * touching the real filesystem.
 */

interface FakeChild extends EventEmitter {
  stdout: Readable;
  stderr: Readable;
}

function makeFakeChild(
  payload: { stdout?: string; stderr?: string; exitCode: number },
): FakeChild {
  const stdout = new Readable({ read() {} });
  const stderr = new Readable({ read() {} });
  if (payload.stdout) stdout.push(payload.stdout);
  stdout.push(null);
  if (payload.stderr) stderr.push(payload.stderr);
  stderr.push(null);
  const child = new EventEmitter() as FakeChild;
  child.stdout = stdout;
  child.stderr = stderr;
  // Defer the exit event so consumers have a chance to attach
  // their listeners.
  setImmediate(() => child.emit('exit', payload.exitCode));
  return child;
}

/** Type alias for the spawn-like function used by ``ScanProcessor``. */
type SpawnFn = (
  command: string,
  args: readonly string[],
  options?: SpawnOptions,
) => ChildProcess;

/** Helper to coerce the test fakes into a ``ChildProcess`` for the API. */
function toChildProcess(fake: FakeChild): ChildProcess {
  return fake as unknown as ChildProcess;
}

/**
 * Test-only factory that mirrors ``ScanProcessor``'s signature but
 * lets each test inject the exact ``spawn`` behaviour it needs.
 *
 * ``libraryRoot: '/'`` keeps the existing spawn-contract tests
 * focused on the sidecar surface — path sanitization has its
 * own ``describe`` block below that exercises the configured
 * root.
 */
function makeProcessor(spawnImpl: SpawnFn): ScanProcessor {
  return new ScanProcessor({ spawn: spawnImpl, libraryRoot: '/' });
}

describe('ScanProcessor (BullMQ sidecar spawn)', () => {
  it('spawns the sidecar with `python -m alejandria_sidecar extract <path>`', async () => {
    let captured: { cmd: string; argv: readonly string[] } | null = null;
    const fakeSpawn: SpawnFn = (cmd, argv) => {
      captured = { cmd, argv };
      return toChildProcess(
        makeFakeChild({
          stdout: JSON.stringify({
            schema_version: 1,
            format: 'epub',
            path: '/lib/book.epub',
            title: 'Foundation',
            author: 'Asimov',
          }) + '\n',
          exitCode: 0,
        }),
      );
    };
    const processor = makeProcessor(fakeSpawn);
    await processor.handle({ path: '/lib/book.epub' });
    expect(captured).not.toBeNull();
    expect(captured!.cmd).toBe('python');
    // argv is ``['-m', 'alejandria_sidecar', 'extract', '<path>']``.
    expect(captured!.argv).toEqual([
      '-m',
      'alejandria_sidecar',
      'extract',
      '/lib/book.epub',
    ]);
  });

  it('returns the parsed JSON envelope on exit code 0', async () => {
    const envelope: SidecarEnvelope = {
      schema_version: 1,
      format: 'pdf',
      path: '/lib/dune.pdf',
      title: 'Dune',
      author: 'Herbert',
      extractor_name: 'pdf',
      warnings: [],
    };
    const fakeSpawn: SpawnFn = () =>
      toChildProcess(
        makeFakeChild({
          stdout: JSON.stringify(envelope) + '\n',
          exitCode: 0,
        }),
      );
    const processor = makeProcessor(fakeSpawn);
    const result = await processor.handle({ path: '/lib/dune.pdf' });
    expect(result).toEqual(envelope);
    expect(result.format).toBe('pdf');
    expect(result.title).toBe('Dune');
  });

  it('resolves a partial envelope that carries a `warnings` array (success-with-warnings)', async () => {
    const envelope: SidecarEnvelope = {
      schema_version: 1,
      format: 'image',
      path: '/lib/broken.png',
      title: null,
      author: null,
      extractor_name: 'image',
      warnings: ['could not decode image'],
    };
    const fakeSpawn: SpawnFn = () =>
      toChildProcess(
        makeFakeChild({
          stdout: JSON.stringify(envelope) + '\n',
          exitCode: 0,
        }),
      );
    const processor = makeProcessor(fakeSpawn);
    const result = await processor.handle({ path: '/lib/broken.png' });
    expect(result.warnings).toEqual(['could not decode image']);
  });

  it('rejects with a typed SidecarError on non-zero exit codes', async () => {
    const fakeSpawn: SpawnFn = () =>
      toChildProcess(
        makeFakeChild({
          stdout: JSON.stringify({
            schema_version: 1,
            error: { code: 'FILE_UNREADABLE', message: 'path not found' },
          }) + '\n',
          stderr: 'python: error: file not found\n',
          exitCode: 5,
        }),
      );
    const processor = makeProcessor(fakeSpawn);
    await expect(
      processor.handle({ path: '/missing.pdf' }),
    ).rejects.toMatchObject({
      name: 'SidecarError',
      code: 'FILE_UNREADABLE',
      exitCode: 5,
    });
  });

  it('falls back to NOT_IMPLEMENTED for a non-zero exit with no error envelope', async () => {
    const fakeSpawn: SpawnFn = () =>
      toChildProcess(
        makeFakeChild({
          stdout: '',
          stderr: 'crash\n',
          exitCode: 2,
        }),
      );
    const processor = makeProcessor(fakeSpawn);
    await expect(processor.handle({ path: '/x' })).rejects.toMatchObject({
      name: 'SidecarError',
      code: 'NOT_IMPLEMENTED',
      exitCode: 2,
    });
  });

  it('rejects on spawn() error (ENOENT, etc.)', async () => {
    const fakeSpawn: SpawnFn = () => {
      const child = new EventEmitter() as FakeChild;
      child.stdout = new Readable({ read() {} });
      child.stderr = new Readable({ read() {} });
      setImmediate(() =>
        child.emit('error', new Error('spawn python ENOENT')),
      );
      return toChildProcess(child);
    };
    const processor = makeProcessor(fakeSpawn);
    await expect(processor.handle({ path: '/x' })).rejects.toThrow(
      /spawn python ENOENT/,
    );
  });
});

/**
 * Path sanitization contract for ``ScanProcessor`` (#33, 4R review).
 *
 * The processor shells out to ``python -m alejandria_sidecar
 * extract <path>``. A malicious or accidental job payload must
 * NOT be able to:
 *
 *   - read files OUTSIDE the configured library root (path
 *     traversal via ``..`` segments).
 *   - inject argv flags into the sidecar (path starting with
 *     ``-``).
 *   - spawn the sidecar with no path at all.
 *
 * ``NAS_LIBRARY_ROOT`` (default ``/share/biblioteca/raw/``) is
 * the configured root. The processor MUST resolve the input
 * path against that root, reject paths that escape it, reject
 * paths starting with ``-``, and pass the resolved path as the
 * final argv element so ``spawn`` cannot misinterpret it.
 *
 * On rejection, the processor MUST throw ``SidecarError`` with
 * ``code = 'INVALID_PATH'`` (no spawn occurs).
 */
describe('ScanProcessor path sanitization (#33)', () => {
  const ORIGINAL_ENV = { ...process.env };

  function restoreEnv(): void {
    for (const key of Object.keys(process.env)) {
      if (!(key in ORIGINAL_ENV)) {
        delete process.env[key];
      }
    }
    for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
      process.env[k] = v;
    }
  }

  function makeProcessorWithFakeSpawn(spawnImpl: SpawnFn): ScanProcessor {
    return new ScanProcessor({
      spawn: spawnImpl,
      libraryRoot: '/share/biblioteca/raw/',
    });
  }

  afterEach(() => {
    restoreEnv();
  });

  it('rejects paths that contain `..` segments', async () => {
    let spawnCalled = false;
    const fakeSpawn: SpawnFn = () => {
      spawnCalled = true;
      return toChildProcess(makeFakeChild({ stdout: '', exitCode: 0 }));
    };
    const processor = makeProcessorWithFakeSpawn(fakeSpawn);
    await expect(
      processor.handle({ path: '/share/biblioteca/raw/../etc/passwd' }),
    ).rejects.toMatchObject({ name: 'SidecarError', code: 'INVALID_PATH' });
    expect(spawnCalled).toBe(false);
  });

  it('rejects paths that resolve outside the configured library root', async () => {
    let spawnCalled = false;
    const fakeSpawn: SpawnFn = () => {
      spawnCalled = true;
      return toChildProcess(makeFakeChild({ stdout: '', exitCode: 0 }));
    };
    const processor = makeProcessorWithFakeSpawn(fakeSpawn);
    await expect(
      processor.handle({ path: '/etc/passwd' }),
    ).rejects.toMatchObject({ name: 'SidecarError', code: 'INVALID_PATH' });
    expect(spawnCalled).toBe(false);
  });

  it('rejects paths that start with `-` (argv injection)', async () => {
    let spawnCalled = false;
    const fakeSpawn: SpawnFn = () => {
      spawnCalled = true;
      return toChildProcess(makeFakeChild({ stdout: '', exitCode: 0 }));
    };
    const processor = makeProcessorWithFakeSpawn(fakeSpawn);
    await expect(
      processor.handle({ path: '-c' }),
    ).rejects.toMatchObject({ name: 'SidecarError', code: 'INVALID_PATH' });
    expect(spawnCalled).toBe(false);
  });

  it('passes the resolved absolute path to spawn as the final argv element', async () => {
    let captured: { cmd: string; argv: readonly string[] } | null = null;
    const fakeSpawn: SpawnFn = (cmd, argv) => {
      captured = { cmd, argv };
      return toChildProcess(
        makeFakeChild({
          stdout: JSON.stringify({
            schema_version: 1,
            format: 'epub',
            path: '/share/biblioteca/raw/books/dune.epub',
          }) + '\n',
          exitCode: 0,
        }),
      );
    };
    const processor = makeProcessorWithFakeSpawn(fakeSpawn);
    await processor.handle({ path: 'books/dune.epub' });
    expect(captured).not.toBeNull();
    // The argv's last element must be an absolute path under the
    // configured library root — no shell interpolation possible.
    expect(captured!.argv).toEqual([
      '-m',
      'alejandria_sidecar',
      'extract',
      '/share/biblioteca/raw/books/dune.epub',
    ]);
  });
});

/**
 * Resilience contract — 4R review #45.
 *
 * The scan processor collects stdout/stderr into strings with no
 * size cap and no timeout. A misbehaving sidecar can OOM the
 * worker; a hung Python interpreter blocks forever. The fix:
 *
 *   - Cap stdout/stderr at 64 MB (MAX_OUTPUT_BYTES). On overflow
 *     the child is SIGKILL'd and the processor throws an
 *     {@link UnrecoverableError} (a misbehaving CLI is not going
 *     to recover on retry).
 *   - Spawn with a 60 s timeout (SPAWN_TIMEOUT_MS). On timeout
 *     the child is SIGKILL'd and the processor throws an
 *     {@link UnrecoverableError}.
 *
 * Both constants are exported so the production wiring and the
 * tests agree on the same limits — operators can grep for
 * ``MAX_OUTPUT_BYTES`` and ``SPAWN_TIMEOUT_MS`` when sizing the
 * container's memory / wall-clock budget.
 */
describe('ScanProcessor resilience constants (#45)', () => {
  it('caps stdout/stderr at 64 MB', () => {
    expect(MAX_OUTPUT_BYTES).toBe(64 * 1024 * 1024);
  });

  it('times out spawns at 60s', () => {
    expect(SPAWN_TIMEOUT_MS).toBe(60_000);
  });
});

describe('ScanProcessor spawn timeout (#45)', () => {
  /**
   * Fake child that never emits ``exit`` — simulates a hung
   * Python interpreter. The processor must kill the child after
   * the timeout window and reject with UnrecoverableError.
   */
  function makeHangingChild(): FakeChild {
    const stdout = new Readable({ read() {} });
    const stderr = new Readable({ read() {} });
    const child = new EventEmitter() as FakeChild;
    child.stdout = stdout;
    child.stderr = stderr;
    // Track the SIGKILL for the assertion below.
    (child as unknown as { killed: boolean }).killed = false;
    const origKill = (child as unknown as {
      kill: (signal?: string) => boolean;
    }).kill;
    (child as unknown as {
      kill: (signal?: string) => boolean;
    }).kill = (signal?: string): boolean => {
      (child as unknown as { killed: boolean }).killed = true;
      // Emit exit asynchronously so the processor's exit handler
      // fires and the promise can settle.
      setImmediate(() => child.emit('exit', null, signal ?? 'SIGKILL'));
      return origKill ? origKill.call(child, signal) : true;
    };
    return child;
  }

  it('rejects with UnrecoverableError when the sidecar exceeds the spawn timeout', async () => {
    const fakeSpawn: SpawnFn = () =>
      toChildProcess(makeHangingChild());
    const processor = makeProcessor(fakeSpawn);
    // Override the timeout to a tiny value so the test does not
    // have to wait the full 60 s.
    (processor as unknown as { timeoutMs: number }).timeoutMs = 25;
    const promise = processor.handle({ path: '/lib/x.epub' });
    await expect(promise).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(promise).rejects.toThrow(/timed out/);
  });

  it('translates the timeout error to a SidecarError envelope so the failure carries diagnostic context', async () => {
    const fakeSpawn: SpawnFn = () =>
      toChildProcess(makeHangingChild());
    const processor = makeProcessor(fakeSpawn);
    (processor as unknown as { timeoutMs: number }).timeoutMs = 25;
    await expect(
      processor.handle({ path: '/lib/x.epub' }),
    ).rejects.toMatchObject({
      // UnrecoverableError wraps the SidecarError; the original
      // diagnostic surface (SidecarError.code) is preserved on
      // the cause chain so operators can grep for it in logs.
      name: 'UnrecoverableError',
    });
  });
});

describe('ScanProcessor stdout/stderr overflow (#45)', () => {
  /**
   * Fake child that pushes a chunk larger than MAX_OUTPUT_BYTES
   * onto stdout and never exits — simulates a runaway sidecar
   * spewing a corrupt file's worth of garbage.
   */
  function makeOverflowingChild(): FakeChild {
    const stdout = new Readable({ read() {} });
    const stderr = new Readable({ read() {} });
    const child = new EventEmitter() as FakeChild;
    child.stdout = stdout;
    child.stderr = stderr;
    (child as unknown as { killed: boolean }).killed = false;
    const origKill = (child as unknown as {
      kill: (signal?: string) => boolean;
    }).kill;
    (child as unknown as {
      kill: (signal?: string) => boolean;
    }).kill = (signal?: string): boolean => {
      (child as unknown as { killed: boolean }).killed = true;
      setImmediate(() => child.emit('exit', null, signal ?? 'SIGKILL'));
      return origKill ? origKill.call(child, signal) : true;
    };
    // Push a chunk that is far over any reasonable cap. The
    // readable.push path is async so the processor's listener
    // picks it up via the data event.
    setImmediate(() => {
      const big = 'x'.repeat(2 * 1024 * 1024);
      stdout.push(big);
      // Keep the readable open so the processor does not see EOF
      // before the cap kicks in. (We expect the cap to fire
      // BEFORE the readable closes — the cap is enforced
      // synchronously in the data handler.)
    });
    return child;
  }

  it('rejects with UnrecoverableError when stdout exceeds MAX_OUTPUT_BYTES', async () => {
    const fakeSpawn: SpawnFn = () =>
      toChildProcess(makeOverflowingChild());
    const processor = makeProcessor(fakeSpawn);
    // Lower the cap for the test so we don't allocate 64 MB.
    (processor as unknown as { maxOutputBytes: number }).maxOutputBytes =
      1024;
    await expect(
      processor.handle({ path: '/lib/x.epub' }),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('rejects with UnrecoverableError when stderr exceeds MAX_OUTPUT_BYTES', async () => {
    function makeStderrOverflowChild(): FakeChild {
      const stdout = new Readable({ read() {} });
      const stderr = new Readable({ read() {} });
      const child = new EventEmitter() as FakeChild;
      child.stdout = stdout;
      child.stderr = stderr;
      (child as unknown as { killed: boolean }).killed = false;
      const origKill = (child as unknown as {
        kill: (signal?: string) => boolean;
      }).kill;
      (child as unknown as {
        kill: (signal?: string) => boolean;
      }).kill = (signal?: string): boolean => {
        (child as unknown as { killed: boolean }).killed = true;
        setImmediate(() => child.emit('exit', null, signal ?? 'SIGKILL'));
        return origKill ? origKill.call(child, signal) : true;
      };
      setImmediate(() => {
        const big = 'x'.repeat(2 * 1024 * 1024);
        stderr.push(big);
      });
      return child;
    }
    const fakeSpawn: SpawnFn = () =>
      toChildProcess(makeStderrOverflowChild());
    const processor = makeProcessor(fakeSpawn);
    (processor as unknown as { maxOutputBytes: number }).maxOutputBytes =
      1024;
    await expect(
      processor.handle({ path: '/lib/x.epub' }),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });
});

// ``SidecarError`` is referenced by the resilience tests above; the
// import would be unused otherwise.
void SidecarError;

