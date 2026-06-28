import { describe, expect, it } from 'vitest'

import {
  CURRENT_EPUBJS_VERSION,
  encodeCfi,
  decodeCfi,
  supportsCfiVersion,
} from '../cfi-wrapper'

/**
 * TDD tests for `lib/reader/cfi-wrapper.ts` (PR-3B scaffold).
 *
 * The full EPUB implementation lands in a follow-up PR; this
 * module ships the versioned contract that downstream readers
 * depend on:
 *
 *  - `CURRENT_EPUBJS_VERSION` — the epub.js minor version this
 *    wrapper is compiled against
 *  - `encodeCfi(cfi)` / `decodeCfi(encoded)` — symmetric codec for
 *    the CFI string the reading-progress table stores
 *  - `supportsCfiVersion(version)` — feature gate so the EPUB
 *    reader can fall back when the bundled epub.js is too old
 *
 * The actual `epubcfi(...)` call lands once the EPUB reader PR
 * wires epub.js into the bundle.
 */

describe('cfi-wrapper (PR-3B scaffold)', () => {
  it('exports a CURRENT_EPUBJS_VERSION that matches the SemVer MAJOR.MINOR shape', () => {
    expect(CURRENT_EPUBJS_VERSION).toMatch(/^\d+\.\d+$/)
  })

  it('round-trips a CFI through encode + decode', () => {
    const cfi = 'epubcfi(/6/4!/4/2/2/2/1:0)'

    const encoded = encodeCfi(cfi)
    const decoded = decodeCfi(encoded)

    expect(decoded).toBe(cfi)
  })

  it('rejects CFI inputs that do not start with "epubcfi("', () => {
    expect(() => encodeCfi('not-a-cfi')).toThrow(/must start with epubcfi/i)
  })

  it('reports support for the current version and the previous minor', () => {
    const [major, minor] = CURRENT_EPUBJS_VERSION.split('.').map(Number) as [number, number]

    expect(supportsCfiVersion(CURRENT_EPUBJS_VERSION)).toBe(true)
    // Same major, previous minor — still supported.
    if (minor > 0) {
      expect(supportsCfiVersion(`${major}.${minor - 1}`)).toBe(true)
    }
  })

  it('rejects unsupported CFI versions (different major)', () => {
    const [major] = CURRENT_EPUBJS_VERSION.split('.').map(Number) as [number, number]
    expect(supportsCfiVersion(`${major + 1}.0`)).toBe(false)
  })
})
