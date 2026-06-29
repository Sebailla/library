import { parseRangeHeader } from './files.service';

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