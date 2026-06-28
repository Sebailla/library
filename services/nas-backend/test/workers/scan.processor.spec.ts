import { spawn, ChildProcess, SpawnOptions } from 'child_process';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
import { ScanProcessor, SidecarEnvelope } from '../../src/workers/scan.processor';

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
 */
function makeProcessor(spawnImpl: SpawnFn): ScanProcessor {
  return new ScanProcessor({ spawn: spawnImpl });
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

