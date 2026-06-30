/**
 * HTTP Range support — type contract for the files module.
 *
 * These shapes live in their own file so the controller, service,
 * and tests can import them without pulling the rest of the module
 * graph. Mirrors RFC 9110 §14.1.2 (Range Requests) but only
 * implements the byte-range subset we need to serve resumable
 * downloads.
 *
 * PR-N1 (NAS backend closure) — GET /api/files/:id with Range.
 */

/**
 * Parsed byte range, inclusive on both ends.
 *
 * Both fields are zero-based byte offsets into the file. ``end``
 * is clamped to ``fileSize - 1`` by {@link parseRangeHeader} when
 * the client omits it (``bytes=N-``) so callers can always assume
 * ``0 <= start <= end < fileSize``.
 */
export interface RangeSpec {
  /** First byte of the slice (inclusive). */
  start: number;
  /** Last byte of the slice (inclusive). */
  end: number;
}

/**
 * Error thrown by {@link parseRangeHeader} when the header is
 * syntactically valid but the range itself cannot be satisfied
 * (e.g. ``start >= fileSize``). The controller maps it to a
 * ``416 Requested Range Not Satisfiable`` response.
 */
export class RangeParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RangeParseError';
  }
}

/**
 * MIME type mapping keyed by the format string stored in the
 * ``books.format`` column.
 *
 * Defined as a plain constant so the controller does not have to
 * depend on a registry module — the universe of supported formats
 * is small and stable (epub, pdf, mobi, azw3, audio, video). Any
 * unmapped format falls back to ``application/octet-stream`` in
 * the controller.
 */
export const FORMAT_TO_MIME: Readonly<Record<string, string>> = {
  epub: 'application/epub+zip',
  pdf: 'application/pdf',
  mobi: 'application/x-mobipocket-ebook',
  azw3: 'application/vnd.amazon.ebook',
  txt: 'text/plain; charset=utf-8',
  html: 'text/html; charset=utf-8',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  m4b: 'audio/mp4',
  wav: 'audio/wav',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  mp4: 'video/mp4',
  mkv: 'video/x-matroska',
};