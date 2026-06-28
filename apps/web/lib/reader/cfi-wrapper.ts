/**
 * Versioned CFI wrapper for epub.js (PR-3B scaffold).
 *
 * The EPUB reader (`epub-reader` spec) needs a stable codec for
 * EPUB CFI strings because epub.js bumps the CFI implementation
 * in minor releases. This module exposes a tiny contract that
 * downstream readers can rely on without coupling to epub.js
 * internals:
 *
 *  - `CURRENT_EPUBJS_VERSION` — the minor version this wrapper is
 *    compiled against. Bumped when the EPUB PR upgrades epub.js.
 *  - `encodeCfi` / `decodeCfi` — symmetric codec for the CFI
 *    strings stored in `reading_progress.last_position`.
 *  - `supportsCfiVersion` — feature gate so the EPUB reader can
 *    fall back gracefully on a too-old epub.js bundle.
 *
 * The full `epubcfi(...)` integration (which requires the epub.js
 * package on the client bundle) lands alongside the EPUB reader
 * PR — see `openspec/changes/alejandria-v2/specs/epub-reader/spec.md`.
 *
 * For PR-3B the codec works on the literal CFI string format
 * (`epubcfi(/...)`) so the contract is verifiable in unit tests
 * without bundling epub.js.
 */

export const CURRENT_EPUBJS_VERSION = '0.3'

const CFI_PREFIX = 'epubcfi('

/**
 * Encode a raw CFI string for storage in `reading_progress.last_position`.
 *
 * Currently a no-op (the CFI string is already canonical), but the
 * codec is in place so the EPUB reader can switch to a wrapper
 * format (e.g. with a version prefix) without changing call sites.
 */
export function encodeCfi(cfi: string): string {
  if (!cfi.startsWith(CFI_PREFIX)) {
    throw new Error(`CFI must start with "${CFI_PREFIX}"; got: ${cfi}`)
  }
  // Wrap the raw CFI with the current wrapper version so a future
  // upgrade can detect old payloads and migrate them.
  return `${CURRENT_EPUBJS_VERSION}:${cfi}`
}

/**
 * Decode a stored CFI payload back into the raw `epubcfi(...)` form.
 */
export function decodeCfi(payload: string): string {
  const colon = payload.indexOf(':')
  if (colon <= 0) {
    throw new Error(`CFI payload missing version prefix: ${payload}`)
  }
  const version = payload.slice(0, colon)
  const cfi = payload.slice(colon + 1)
  if (!cfi.startsWith(CFI_PREFIX)) {
    throw new Error(`Decoded CFI must start with "${CFI_PREFIX}"; got: ${cfi}`)
  }
  if (!supportsCfiVersion(version)) {
    throw new Error(`CFI payload uses unsupported version: ${version}`)
  }
  return cfi
}

/**
 * Feature gate: returns `true` for the current major version
 * (any minor), `false` for different majors or unparseable input.
 */
export function supportsCfiVersion(version: string): boolean {
  const match = /^(\d+)\.(\d+)$/.exec(version)
  if (!match) return false
  const current = /^(\d+)\.(\d+)$/.exec(CURRENT_EPUBJS_VERSION)
  if (!current) return false
  return match[1] === current[1]
}
