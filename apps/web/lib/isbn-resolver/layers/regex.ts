/**
 * Layer 2 of the 7-layer ISBN chain — regex over text
 * (PR-4A, issue #71).
 *
 * When the file does not declare its ISBN, we scan the
 * first 50,000 characters of extracted text for the first
 * valid ISBN-10 or ISBN-13 token. The match is normalized
 * and returned with `source = 'regex'`.
 *
 * The layer does NOT open the file. The orchestrator
 * passes the pre-extracted text via `book.textSnippet`
 * (the sidecar is the canonical extractor; we don't
 * re-extract here). The pure helper `extractIsbnFromText`
 * is exported so the regex logic is testable in
 * isolation.
 *
 * The regex is permissive: it accepts digits, dashes, and
 * spaces between groups. Each candidate is fed through
 * `normalizeIsbn`, which validates the check digit and
 * converts ISBN-10 → ISBN-13. Anything that fails the
 * checksum is rejected — we never return an ISBN-shaped
 * string that is not a real ISBN.
 */

import type { BookInput, IsbnCandidate, LayerContext } from '../types'
import { normalizeIsbn } from '../validate'

/** Hard cap on the text we scan, per the spec. */
const MAX_TEXT_CHARS = 50_000

/**
 * Layer-2 entry point. Returns the first ISBN-shaped
 * candidate from `book.textSnippet`, or `null` when the
 * text is missing or carries no valid ISBN.
 */
export async function extractRegexIsbn(
  book: BookInput,
  _ctx: LayerContext,
): Promise<IsbnCandidate | null> {
  const text = book.textSnippet
  if (!text) return null
  const found = extractIsbnFromText(text)
  if (!found) return null
  return {
    isbn: found,
    source: 'regex',
    confidence: 0.9,
    raw: { match: found },
  }
}

/**
 * Pure helper: scan a chunk of text for the first valid
 * ISBN. Returns the normalized ISBN-13 (or ISBN-10 when
 * the candidate only has 10 digits) or `null` on miss.
 *
 * The match is greedy on 13 digits / 10 digits / 13
 * digits-with-dashes / 10 digits-with-dashes; each
 * candidate is fed through `normalizeIsbn` so the
 * checksum is verified. The first checksum-valid hit
 * wins.
 */
export function extractIsbnFromText(text: string): string | null {
  if (!text) return null
  const capped = text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text
  // Match a run of 10-17 digits / dashes / spaces that
  // contains at least 10 or 13 digits. We do NOT pre-filter
  // by checksum here — the regex finds candidates, the
  // checksum decides.
  const re = /[\d][\d\s-]{8,18}[\d]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(capped)) !== null) {
    const candidate = m[0]
    if (!candidate) continue
    const normalized = normalizeIsbn(candidate)
    if (normalized) return normalized
  }
  return null
}
