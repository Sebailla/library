/**
 * Canonical-path resolver for the admin organize surface (PR-N5).
 *
 * Pure functions only — no fs, no DB, no clock. The implementation
 * mirrors the convention documented in refactor 08:
 *
 *   {root}/{Apellido}, {Nombre} - {Título} ({Año}).{ext}
 *
 * Missing fields degrade to safe placeholders (``_anonymous`` for
 * the author segment, ``Unknown`` for title/year) so the analyze
 * step can produce a consistent path even when the upstream
 * extractor reported low confidence. If the file has no extension
 * at all the resolver returns ``null`` — the analyze step
 * interprets this as "skip with reason" rather than creating a
 * file with a nameless extension.
 */

/**
 * Lightweight author shape the resolver needs. Decoupled from the
 * ``books`` / ``authors`` DB types so the test surface does not
 * require a live connection.
 */
export interface AuthorForPath {
  lastname: string | null;
  firstname: string | null;
}

/**
 * Input the resolver consumes. All fields except ``rootPath``
 * and ``extension`` MAY be null to model a low-confidence
 * extraction.
 */
export interface CanonicalPathInput {
  rootPath: string;
  author: AuthorForPath | null;
  title: string | null;
  year: number | null;
  extension: string | null;
}

/**
 * Strip filesystem-unsafe characters from a string segment so it
 * can be used as part of a path or filename. Replaces ``/``, ``\``
 * and ``:`` (the characters most likely to come from pasted
 * filenames) with ``-`` and trims leading/trailing whitespace.
 *
 * The replacement is intentionally narrow — the pipeline does not
 * want to silently rewrite user-visible characters beyond the
 * minimal set that would break a POSIX path.
 */
export function sanitizeFilenamePart(value: string): string {
  return value.trim().replace(/[/\\:]/g, '-');
}

/**
 * Build the canonical author folder segment. Returns the literal
 * ``_anonymous`` when the author is unknown (matches refactor 08).
 * ``firstname`` is dropped when missing so a series-only entry
 * still produces a clean folder name.
 */
export function resolveCanonicalAuthorKey(
  author: AuthorForPath | null | undefined,
): string {
  if (!author || !author.lastname) {
    return '_anonymous';
  }
  const safe = sanitizeFilenamePart(author.lastname);
  if (!author.firstname) {
    return safe;
  }
  return `${safe}, ${sanitizeFilenamePart(author.firstname)}`;
}

/**
 * Map a year number to the parenthesised ``({YYYY})`` segment.
 * Returns ``Unknown`` for null/invalid input so the layout stays
 * consistent even when the extractor failed.
 */
function formatYear(year: number | null): string {
  if (typeof year !== 'number' || !Number.isFinite(year) || year <= 0) {
    return 'Unknown';
  }
  return String(Math.trunc(year));
}

/**
 * Compose the canonical path. Returns ``null`` when the input
 * carries no extension — without one, the resolver cannot
 * produce a path the filesystem can represent.
 */
export function resolveCanonicalPath(input: CanonicalPathInput): string | null {
  if (!input.extension) {
    return null;
  }
  const authorKey = resolveCanonicalAuthorKey(input.author);
  const titleSeg = sanitizeFilenamePart(input.title ?? 'Unknown') || 'Unknown';
  const yearSeg = formatYear(input.year);
  const ext = sanitizeFilenamePart(input.extension).toLowerCase() || 'bin';
  return `${input.rootPath}/${authorKey}/${titleSeg} (${yearSeg}).${ext}`;
}
