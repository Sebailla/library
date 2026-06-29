/**
 * ISBN checksum + normalization helpers (PR-4A, issue #71).
 *
 * This module is the only place that knows the ISBN-10 and
 * ISBN-13 check-digit algorithms. Every layer that
 * produces a candidate MUST run the candidate through
 * `normalizeIsbn` before returning it; otherwise we leak
 * raw "978-0-13-409865-3" strings into the cache and the
 * `isbn_resolutions` table.
 *
 * `isValidIsbn10` and `isValidIsbn13` are pure functions
 * over the digit string — no regex pre-filter, no
 * transformation. They return `true` only when the check
 * digit is mathematically valid.
 *
 * ISBN-10 check digit: weighted sum with weights
 * [10, 9, 8, ..., 2] plus a final character that may be
 * `0`-`9` or `X` (representing 10). Sum must be ≡ 0 (mod 11).
 *
 * ISBN-13 check digit: weighted sum with alternating
 * weights 1 and 3. Sum mod 10 must be 0.
 *
 * ISBN-10 → ISBN-13 conversion: prefix with `978`,
 * recompute the ISBN-13 check digit. ISBN-10 → ISBN-13
 * is the only direction we expose — the reverse
 * (ISBN-13 → ISBN-10) is lossy (only ISBN-13s in the
 * `978-` range can be downgraded) and the spec does
 * not require it.
 */

/** Digits 0-9, plus the literal 'X' for ISBN-10 check. */
const DIGIT_OR_X = /^[0-9Xx]+$/

/**
 * Returns true if `s` is a structurally valid ISBN-10
 * (10 characters, digits 0-9 with optional trailing X,
 * check digit matches the weighted sum mod 11).
 */
export function isValidIsbn10(s: string): boolean {
  if (typeof s !== 'string') return false
  if (s.length !== 10) return false
  if (!DIGIT_OR_X.test(s)) return false
  let sum = 0
  for (let i = 0; i < 9; i++) {
    const ch = s.charAt(i)
    const d = Number(ch)
    if (Number.isNaN(d)) return false
    sum += d * (10 - i)
  }
  const last = s.charAt(9)
  const checkValue = last === 'X' || last === 'x' ? 10 : Number(last)
  if (Number.isNaN(checkValue)) return false
  sum += checkValue
  return sum % 11 === 0
}

/**
 * Returns true if `s` is a structurally valid ISBN-13
 * (13 digits, check digit matches the weighted sum with
 * alternating 1/3 weights mod 10).
 */
export function isValidIsbn13(s: string): boolean {
  if (typeof s !== 'string') return false
  if (s.length !== 13) return false
  if (!/^[0-9]+$/.test(s)) return false
  let sum = 0
  for (let i = 0; i < 13; i++) {
    const d = Number(s.charAt(i))
    if (Number.isNaN(d)) return false
    const weight = i % 2 === 0 ? 1 : 3
    sum += d * weight
  }
  return sum % 10 === 0
}

/**
 * Normalize an ISBN string to its canonical form:
 *  - strip whitespace and dashes
 *  - uppercase the trailing 'x' in ISBN-10
 *  - validate the check digit
 *  - convert ISBN-10 to ISBN-13 (prefix 978, recompute)
 *
 * Returns the normalized ISBN-13 (or ISBN-10 if `keepIsbn10`
 * is set) on success; returns `null` on any failure.
 *
 * Callers should treat `null` as "this is not a usable
 * ISBN" and skip it. The cache and the database never
 * see invalid ISBNs.
 */
export function normalizeIsbn(
  raw: string,
  options: { keepIsbn10?: boolean } = {},
): string | null {
  if (typeof raw !== 'string') return null
  const stripped = raw.replace(/[\s-]+/g, '').toUpperCase()
  if (stripped.length === 0) return null
  if (isValidIsbn13(stripped)) {
    return stripped
  }
  if (isValidIsbn10(stripped)) {
    if (options.keepIsbn10) return stripped
    return isbn10ToIsbn13(stripped)
  }
  return null
}

/**
 * Convert a validated ISBN-10 to its ISBN-13 form
 * (prefix 978, recompute check digit). Caller MUST have
 * validated with `isValidIsbn10` first; this function
 * does not re-validate.
 */
export function isbn10ToIsbn13(isbn10: string): string {
  if (isbn10.length !== 10) {
    throw new Error(`isbn10ToIsbn13: expected 10 chars, got ${isbn10.length}`)
  }
  const body = `978${isbn10.slice(0, 9)}`
  let sum = 0
  for (let i = 0; i < 12; i++) {
    const d = Number(body.charAt(i))
    const weight = i % 2 === 0 ? 1 : 3
    sum += d * weight
  }
  const check = (10 - (sum % 10)) % 10
  return body + String(check)
}
