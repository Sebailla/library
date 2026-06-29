/**
 * TDD tests for `lib/isbn-resolver/validate.ts` (PR-4A, #71).
 *
 * The validate module is the ONLY place that knows the
 * ISBN-10 and ISBN-13 check-digit algorithms. Every layer
 * produces a candidate via `normalizeIsbn` before writing
 * to the cache, so these tests guard the wire format.
 *
 * Coverage:
 *  - isValidIsbn10 accepts canonical ISBN-10, rejects bad
 *    check digits, rejects wrong lengths, rejects 'X' in
 *    non-check position.
 *  - isValidIsbn13 accepts canonical ISBN-13, rejects bad
 *    check digits, rejects wrong lengths, rejects
 *    non-digits.
 *  - normalizeIsbn strips dashes/spaces, returns ISBN-13
 *    for both ISBN-10 and ISBN-13 inputs, returns null
 *    for garbage, and converts ISBN-10 → ISBN-13 with the
 *    correct recomputed check digit.
 *  - isbn10ToIsbn13 throws on bad length (defensive
 *    contract).
 */

import { describe, expect, it } from 'vitest'

import {
  isValidIsbn10,
  isValidIsbn13,
  normalizeIsbn,
  isbn10ToIsbn13,
} from '../validate'

describe('isbn-resolver/validate (PR-4A, #71)', () => {
  describe('isValidIsbn10', () => {
    it('accepts a canonical ISBN-10 with a numeric check digit', () => {
      // "0306406152" — sum 0*10 + 3*9 + 0*8 + 6*7 + 4*6 + 0*5 + 6*4 + 1*3 + 5*2 + 2 = 110, 110 mod 11 = 0.
      expect(isValidIsbn10('0306406152')).toBe(true)
    })

    it('accepts a canonical ISBN-10 with an X check digit', () => {
      // "155404295X" — published example with X check.
      expect(isValidIsbn10('155404295X')).toBe(true)
      expect(isValidIsbn10('155404295x')).toBe(true)
    })

    it('rejects an ISBN-10 with a wrong check digit', () => {
      expect(isValidIsbn10('0306406153')).toBe(false)
    })

    it('rejects strings of the wrong length', () => {
      expect(isValidIsbn10('123456789')).toBe(false) // 9 chars
      expect(isValidIsbn10('12345678901')).toBe(false) // 11 chars
      expect(isValidIsbn10('')).toBe(false)
    })

    it('rejects X in any non-check position', () => {
      expect(isValidIsbn10('X306406152')).toBe(false)
    })

    it('rejects non-string input', () => {
      expect(isValidIsbn10(1234567890 as unknown as string)).toBe(false)
      expect(isValidIsbn10(null as unknown as string)).toBe(false)
      expect(isValidIsbn10(undefined as unknown as string)).toBe(false)
    })
  })

  describe('isValidIsbn13', () => {
    it('accepts a canonical ISBN-13', () => {
      // 978-0-306-40615-7 — known valid example.
      expect(isValidIsbn13('9780306406157')).toBe(true)
    })

    it('rejects an ISBN-13 with a wrong check digit', () => {
      expect(isValidIsbn13('9780306406158')).toBe(false)
    })

    it('rejects strings of the wrong length', () => {
      expect(isValidIsbn13('978030640615')).toBe(false) // 12
      expect(isValidIsbn13('97803064061577')).toBe(false) // 14
    })

    it('rejects non-digit characters (X is not valid in ISBN-13)', () => {
      expect(isValidIsbn13('978030640615X')).toBe(false)
      expect(isValidIsbn13('978030640615-')).toBe(false)
    })
  })

  describe('normalizeIsbn', () => {
    it('strips dashes and spaces before validating', () => {
      expect(normalizeIsbn('978-0-306-40615-7')).toBe('9780306406157')
      expect(normalizeIsbn('978 0 306 40615 7')).toBe('9780306406157')
    })

    it('returns the ISBN-13 unchanged when it is already canonical', () => {
      expect(normalizeIsbn('9780306406157')).toBe('9780306406157')
    })

    it('converts an ISBN-10 to its ISBN-13 form (978 prefix + recomputed check)', () => {
      // "0306406152" → "9780306406157" (recomputed check digit).
      expect(normalizeIsbn('0306406152')).toBe('9780306406157')
      expect(normalizeIsbn('0-306-40615-2')).toBe('9780306406157')
    })

    it('keeps ISBN-10 when keepIsbn10 is set', () => {
      expect(normalizeIsbn('0306406152', { keepIsbn10: true })).toBe('0306406152')
    })

    it('returns null for invalid input', () => {
      expect(normalizeIsbn('not-an-isbn')).toBeNull()
      expect(normalizeIsbn('9780306406158')).toBeNull() // bad check
      expect(normalizeIsbn('')).toBeNull()
      expect(normalizeIsbn('97803064061')).toBeNull() // too short
    })

    it('uppercases a lowercase x in ISBN-10 check position', () => {
      expect(normalizeIsbn('155404295x', { keepIsbn10: true })).toBe('155404295X')
    })
  })

  describe('isbn10ToIsbn13', () => {
    it('recomputes the check digit for a known ISBN-10', () => {
      expect(isbn10ToIsbn13('0306406152')).toBe('9780306406157')
      expect(isbn10ToIsbn13('155404295X')).toBe('9781554042951')
    })

    it('throws on a wrong-length input', () => {
      expect(() => isbn10ToIsbn13('12345')).toThrow(/expected 10 chars/)
    })
  })
})
