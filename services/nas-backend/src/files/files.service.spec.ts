import { FilesService, parseRangeHeader } from './files.service';

/**
 * Contract tests for {@link parseRangeHeader}.
 *
 * Scope:
 *   - ``bytes=N-M``         → returns { start: N, end: M }
 *   - ``bytes=N-``          → end is clamped to fileSize - 1
 *   - ``bytes=-N`` (suffix) → start = fileSize - N, end = fileSize - 1
 *   - ``undefined`` / empty → null (controller falls back to 200 full)
 *   - multi-range ("bytes=0-99,200-299") → null (not supported)
 *   - start >= fileSize     → null (controller will respond 416)
 *   - invalid numbers       → null (silently ignored, full body)
 *
 * The parser is a pure function so the assertions are direct and
 * require no DI setup — see PR-N1 spec §1.
 */

describe('parseRangeHeader', () => {
  it('parses a closed bytes=0-1023 range', () => {
    expect(parseRangeHeader('bytes=0-1023', 4096)).toEqual({
      start: 0,
      end: 1023,
    });
  });

  it('clamps end to fileSize - 1 when bytes=N- is requested', () => {
    expect(parseRangeHeader('bytes=1024-', 4096)).toEqual({
      start: 1024,
      end: 4095,
    });
  });

  it('parses a suffix range bytes=-N as the last N bytes', () => {
    expect(parseRangeHeader('bytes=-256', 4096)).toEqual({
      start: 4096 - 256,
      end: 4095,
    });
  });

  it('returns null when the header is undefined (full body)', () => {
    expect(parseRangeHeader(undefined, 4096)).toBeNull();
  });

  it('returns null when the header is an empty string', () => {
    expect(parseRangeHeader('', 4096)).toBeNull();
  });

  it('returns null for multi-range requests (not supported)', () => {
    expect(parseRangeHeader('bytes=0-99,200-299', 4096)).toBeNull();
  });

  it('returns null when start >= fileSize (caller emits 416)', () => {
    expect(parseRangeHeader('bytes=5000-', 4096)).toBeNull();
  });

  it('returns null when the header does not start with bytes=', () => {
    expect(parseRangeHeader('items=0-99', 4096)).toBeNull();
  });

  it('returns null for non-numeric ranges', () => {
    expect(parseRangeHeader('bytes=abc-def', 4096)).toBeNull();
  });
});

/**
 * Contract tests for {@link FilesService.resolveBookFilePath}.
 *
 * The repository contract is exercised through an in-memory stub
 * (matching the rest of the project's e2e tests) so the path-
 * resolution logic is the only thing under test.
 *
 * Scope:
 *   - book missing            → NotFoundException(FILE_NOT_FOUND)
 *   - stored path inside root → absolute resolved path under root
 *   - ``..`` traversal        → NotFoundException(FILE_NOT_FOUND)
 *   - absolute stored path outside root → NotFoundException(FILE_NOT_FOUND)
 */
describe('resolveBookFilePath', () => {
  function makeBooks(rows: Array<{ id: number; filePath: string }>) {
    return {
      findById: async (id: number) => {
        const row = rows.find((r) => r.id === id);
        return row ?? null;
      },
      // Unused by these tests but required to satisfy the type.
      insert: async () => {
        throw new Error('not used');
      },
      list: async () => [],
      count: async () => 0,
      search: async () => [],
      close: async () => undefined,
    };
  }

  it('resolves a relative stored path against the library root', async () => {
    const books = makeBooks([
      { id: 1, filePath: 'authors/asimov/foundation.epub' },
    ]);
    const svc = new FilesService(books as never, '/srv/library');
    const resolved = await svc.resolveBookFilePath(1);
    // Normalised, separator-stable representation. We assert on
    // the suffix rather than the exact string so the test is
    // portable across POSIX (CI) and Windows-style paths.
    expect(resolved.replace(/\\/g, '/')).toBe(
      '/srv/library/authors/asimov/foundation.epub',
    );
  });

  it('throws FILE_NOT_FOUND when the book does not exist', async () => {
    const books = makeBooks([]);
    const svc = new FilesService(books as never, '/srv/library');
    await expect(svc.resolveBookFilePath(99)).rejects.toMatchObject({
      response: { error: { code: 'FILE_NOT_FOUND' } },
    });
  });

  it('refuses stored paths that escape the library root via ..', async () => {
    const books = makeBooks([
      { id: 1, filePath: '../etc/passwd' },
    ]);
    const svc = new FilesService(books as never, '/srv/library');
    await expect(svc.resolveBookFilePath(1)).rejects.toMatchObject({
      response: { error: { code: 'FILE_NOT_FOUND' } },
    });
  });

  it('refuses stored absolute paths outside the library root', async () => {
    const books = makeBooks([
      { id: 1, filePath: '/etc/passwd' },
    ]);
    const svc = new FilesService(books as never, '/srv/library');
    await expect(svc.resolveBookFilePath(1)).rejects.toMatchObject({
      response: { error: { code: 'FILE_NOT_FOUND' } },
    });
  });
});