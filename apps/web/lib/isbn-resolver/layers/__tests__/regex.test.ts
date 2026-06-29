/**
 * TDD tests for `lib/isbn-resolver/layers/regex.ts` (PR-4A, #71).
 *
 * Layer 2 of the 7-layer chain. When the file does not
 * declare its ISBN, we scan the first 50,000 characters
 * of extracted text for the first valid ISBN-10 or
 * ISBN-13 token. The match is normalized and returned
 * with `source = 'regex'`.
 *
 * The layer is a pure function over text — it does NOT
 * need to open the file. `BookInput.textSnippet` is the
 * pre-extracted text (orchestrator's responsibility).
 *
 * Coverage:
 *  - Finds ISBN-13 inside text.
 *  - Finds ISBN-10 inside text and normalizes to ISBN-13.
 *  - Handles hyphenated and spaced forms.
 *  - Ignores ISBN-like strings that fail the checksum.
 *  - Returns null on empty text.
 *  - Returns null when no ISBN-shaped token exists.
 *  - The exported pure helper `extractIsbnFromText` is
 *    independently testable.
 */

import { describe, expect, it } from 'vitest'

import { createInMemoryIsbnCache } from '../../cache'
import { extractIsbnFromText, extractRegexIsbn } from '../regex'

function makeCtx() {
  return { cache: createInMemoryIsbnCache() }
}

describe('isbn-resolver/layers/regex (PR-4A, #71)', () => {
  describe('extractIsbnFromText (pure helper)', () => {
    it('finds the first ISBN-13 in a body of text', () => {
      const text = 'Some preface text ISBN 9780306406157 ends here.'
      expect(extractIsbnFromText(text)).toBe('9780306406157')
    })

    it('finds the first ISBN-10 in a body of text and normalizes to ISBN-13', () => {
      const text = 'Old edition: ISBN 0-306-40615-2 published in 1999.'
      expect(extractIsbnFromText(text)).toBe('9780306406157')
    })

    it('handles hyphenated and spaced ISBN-13s', () => {
      expect(extractIsbnFromText('foo 978 0 306 40615 7 bar')).toBe(
        '9780306406157',
      )
      expect(extractIsbnFromText('foo 978-0-13-409865-4 bar')).toBe(
        '9780134098654',
      )
    })

    it('prefers the first hit when multiple candidates are present', () => {
      const text =
        'noise 9780306406157 in the middle 9780134098654 noise'
      expect(extractIsbnFromText(text)).toBe('9780306406157')
    })

    it('ignores ISBN-shaped strings that fail the checksum', () => {
      // Bad ISBN-13 checksum → reject.
      expect(extractIsbnFromText('9780306406158 should be ignored')).toBeNull()
      // Bad ISBN-10 checksum → reject.
      expect(extractIsbnFromText('0-306-40615-9 should be ignored')).toBeNull()
    })

    it('returns null on empty / whitespace-only text', () => {
      expect(extractIsbnFromText('')).toBeNull()
      expect(extractIsbnFromText('   \n  \t  ')).toBeNull()
    })

    it('returns null when no ISBN-shaped token is present', () => {
      expect(extractIsbnFromText('No ISBN here, just words and 12 digits 12345.')).toBeNull()
    })
  })

  describe('extractRegexIsbn (Layer 2 entry point)', () => {
    it('returns a regex-source candidate from textSnippet', async () => {
      const result = await extractRegexIsbn(
        {
          title: 'X',
          author: 'Y',
          format: 'pdf',
          filePath: '/x.pdf',
          textSnippet: 'The ISBN is 9780306406157 according to the colophon.',
        },
        makeCtx(),
      )
      expect(result).toEqual({
        isbn: '9780306406157',
        source: 'regex',
        confidence: 0.9,
        raw: expect.objectContaining({ match: expect.any(String) }),
      })
    })

    it('returns null when no textSnippet is provided', async () => {
      const result = await extractRegexIsbn(
        { title: 'X', format: 'pdf', filePath: '/x.pdf' },
        makeCtx(),
      )
      expect(result).toBeNull()
    })

    it('returns null when the textSnippet has no ISBN', async () => {
      const result = await extractRegexIsbn(
        {
          title: 'X',
          format: 'pdf',
          filePath: '/x.pdf',
          textSnippet: 'just some words, nothing useful',
        },
        makeCtx(),
      )
      expect(result).toBeNull()
    })
  })
})
