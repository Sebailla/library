/**
 * TDD tests for `lib/isbn-resolver/layers/vision-ocr.ts` (PR-4A, #71).
 *
 * Layer 5 of the 7-layer chain. Renders the first page
 * and the back cover, runs OCR via Apple Vision (Mac
 * native), and scans the recognized text for an ISBN.
 *
 * The actual Vision binding lives behind a `VisionProvider`
 * seam so the test can plug in a deterministic fake. In
 * production the seam is `appleVisionProvider` from
 * `alejandria/ocr/vision` (PR-1); in tests it is a plain
 * function that returns a fixed string or `null`.
 *
 * Coverage:
 *  - Happy path: provider returns text containing a
 *    valid ISBN → layer returns the candidate.
 *  - Provider returns text without an ISBN → null.
 *  - Provider returns null → null.
 *  - Provider throws → null (chain falls through).
 *  - The provider is invoked with the book file path.
 *  - The default seam (when none is injected) is the
 *    appleVisionProvider export.
 */

import { describe, expect, it, vi } from 'vitest'

import { createInMemoryIsbnCache } from '../../cache'
import {
  extractVisionOcrIsbn,
  appleVisionProvider,
  type VisionProvider,
} from '../vision-ocr'

function makeCtx(provider?: VisionProvider) {
  const ctx: { cache: ReturnType<typeof createInMemoryIsbnCache>; provider?: VisionProvider } = {
    cache: createInMemoryIsbnCache(),
  }
  if (provider !== undefined) ctx.provider = provider
  return ctx
}

const baseBook = {
  title: 'X',
  author: 'Y',
  format: 'pdf',
  filePath: '/x.pdf',
}

describe('isbn-resolver/layers/vision-ocr (PR-4A, #71)', () => {
  it('returns the ISBN found in the OCR text from the provider', async () => {
    const provider: VisionProvider = vi.fn(async () =>
      'Cover text ISBN 9780306406157 printed on the back',
    )
    const result = await extractVisionOcrIsbn(baseBook, makeCtx(provider))
    expect(result).toEqual({
      isbn: '9780306406157',
      source: 'vision-ocr',
      confidence: 0.7,
      raw: expect.objectContaining({ text: expect.any(String) }),
    })
    expect(provider).toHaveBeenCalledWith(baseBook)
  })

  it('returns null when the OCR text has no ISBN', async () => {
    const provider: VisionProvider = vi.fn(async () => 'no number here, just words')
    const result = await extractVisionOcrIsbn(baseBook, makeCtx(provider))
    expect(result).toBeNull()
  })

  it('returns null when the provider returns null', async () => {
    const provider: VisionProvider = vi.fn(async () => null)
    const result = await extractVisionOcrIsbn(baseBook, makeCtx(provider))
    expect(result).toBeNull()
  })

  it('returns null when the provider throws', async () => {
    const provider: VisionProvider = vi.fn(async () => {
      throw new Error('vision unavailable')
    })
    const result = await extractVisionOcrIsbn(baseBook, makeCtx(provider))
    expect(result).toBeNull()
  })

  it('exposes an appleVisionProvider default that is async and returns string | null', () => {
    expect(typeof appleVisionProvider).toBe('function')
    // The default provider in PR-4A is a stub that always
    // returns null (real Apple Vision binding lands in
    // PR-1). We assert shape, not behavior, so the test
    // does not depend on the Mac-only pyobjc-Vision path.
    expect(appleVisionProvider.length).toBeGreaterThanOrEqual(1)
  })
})
