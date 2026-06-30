import {
  resolveCanonicalPath,
  resolveCanonicalAuthorKey,
  sanitizeFilenamePart,
} from '../../../src/admin/organize/organize-path-resolver';

/**
 * Contract tests for {@link resolveCanonicalPath} and helpers
 * (PR-N5).
 *
 * Per refactor 08 (estructura-de-carpetas) the canonical layout is:
 *
 *   {root}/{Apellido}, {Nombre} - {Título} ({Año}).{ext}
 *
 * Tests pin:
 *   - the canonical layout string
 *   - ``null`` metadata degrades to ``null`` (analyze decides how
 *     to route low-confidence cases)
 *   - ``_anonymous/`` for missing author (per refactor 08)
 *   - title / year fall back to placeholder ``Unknown`` so the
 *     pipeline can still produce a path the operator can read
 *   - filename sanitisation strips path separators that would
 *     break the canonical layout
 *
 * Pure functions only — no fs, no DB, no async.
 */

describe('organize-path-resolver', () => {
  it('sanitizeFilenamePart replaces /, \\, : and trims whitespace', () => {
    expect(sanitizeFilenamePart('Borges / Jorge: Luis')).toBe('Borges - Jorge- Luis');
    expect(sanitizeFilenamePart('  Tolkien  ')).toBe('Tolkien');
    expect(sanitizeFilenamePart('a/b\\c:d')).toBe('a-b-c-d');
  });

  it('resolveCanonicalAuthorKey formats as "{Apellido}, {Nombre}"', () => {
    expect(
      resolveCanonicalAuthorKey({ lastname: 'Borges', firstname: 'Jorge Luis' }),
    ).toBe('Borges, Jorge Luis');
  });

  it('resolveCanonicalAuthorKey drops firstname when missing', () => {
    expect(
      resolveCanonicalAuthorKey({ lastname: 'Anonymous', firstname: null }),
    ).toBe('Anonymous');
  });

  it('resolveCanonicalAuthorKey routes missing lastname to _anonymous/', () => {
    expect(
      resolveCanonicalAuthorKey({ lastname: null, firstname: 'Mary' }),
    ).toBe('_anonymous');
  });

  it('resolveCanonicalAuthorKey routes both-missing to _anonymous/', () => {
    expect(
      resolveCanonicalAuthorKey({ lastname: null, firstname: null }),
    ).toBe('_anonymous');
  });

  it('resolveCanonicalPath produces {root}/{Apellido}, {Nombre} - {Título} ({Año}).{ext}', () => {
    const result = resolveCanonicalPath(
      {
        rootPath: '/share/biblioteca/raw',
        author: { lastname: 'Tolkien', firstname: 'J.R.R.' },
        title: 'El Hobbit',
        year: 1937,
        extension: 'pdf',
      },
    );
    expect(result).toBe('/share/biblioteca/raw/Tolkien, J.R.R./El Hobbit (1937).pdf');
  });

  it('resolveCanonicalPath uses _anonymous/ and an Unknown placeholder when metadata is partial', () => {
    const result = resolveCanonicalPath(
      {
        rootPath: '/share/biblioteca/raw',
        author: null,
        title: null,
        year: null,
        extension: 'epub',
      },
    );
    expect(result).toBe('/share/biblioteca/raw/_anonymous/Unknown (Unknown).epub');
  });

  it('resolveCanonicalPath sanitises title characters that would break the layout', () => {
    const result = resolveCanonicalPath(
      {
        rootPath: '/data',
        author: { lastname: 'Borges', firstname: 'Jorge Luis' },
        title: 'Ficciones / El jardín',
        year: 1944,
        extension: 'epub',
      },
    );
    // The slash inside the title is the dangerous one — the layout
    // relies on the author segment being a single directory level.
    expect(result).toBe('/data/Borges, Jorge Luis/Ficciones - El jardín (1944).epub');
  });

  it('resolveCanonicalPath returns null when extension is missing (cannot build a filename)', () => {
    const result = resolveCanonicalPath(
      {
        rootPath: '/data',
        author: { lastname: 'Borges', firstname: 'Jorge Luis' },
        title: 'Ficciones',
        year: 1944,
        extension: null,
      },
    );
    // No extension means we cannot represent the file at all in
    // the filesystem. The analyze pipeline treats null as "skip
    // with reason".
    expect(result).toBeNull();
  });

  it('resolveCanonicalPath returns null when author/title/year are all missing AND extension is null', () => {
    const result = resolveCanonicalPath(
      {
        rootPath: '/data',
        author: null,
        title: null,
        year: null,
        extension: null,
      },
    );
    expect(result).toBeNull();
  });

  it('resolveCanonicalPath lowercases the extension', () => {
    const result = resolveCanonicalPath(
      {
        rootPath: '/data',
        author: { lastname: 'Borges', firstname: 'Jorge Luis' },
        title: 'Ficciones',
        year: 1944,
        extension: 'EPUB',
      },
    );
    expect(result).toBe('/data/Borges, Jorge Luis/Ficciones (1944).epub');
  });
});
