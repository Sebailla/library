/**
 * Layer 5 of the 7-layer ISBN chain — Vision OCR on the
 * cover (PR-4A, issue #71).
 *
 * Renders the first page and the back cover, runs OCR via
 * Apple Vision (Mac native), and scans the recognized
 * text for an ISBN. The actual Vision binding lives
 * behind a `VisionProvider` seam:
 *
 *   type VisionProvider = (book: BookInput) => Promise<string | null>
 *
 * The production default is `appleVisionProvider`, a
 * stub that returns `null` until the PR-1 sidecar
 * wires the real pyobjc-Vision bridge. Tests inject a
 * deterministic fake.
 *
 * The layer NEVER throws. A provider error collapses
 * to `null` so the chain can move to layer 6.
 *
 * The 0.7 confidence reflects the fact that the ISBN
 * came from an OCR pass on the cover, which is
 * inherently noisier than a checksum-valid match.
 */

import type { BookInput, IsbnCandidate, LayerContext } from '../types'
import { extractIsbnFromText } from './regex'
import { normalizeIsbn } from '../validate'

/**
 * Vision provider seam. Receives the book and returns
 * the OCR-recognized text from the rendered cover and
 * back cover, or `null` if OCR is unavailable / produced
 * nothing usable.
 */
export type VisionProvider = (book: BookInput) => Promise<string | null>

/**
 * Default Vision provider. In PR-4A this is a stub that
 * returns `null` — the real Apple Vision binding lands
 * in PR-1 (`alejandria/ocr/vision`). The layer is wired
 * up today so PR-4A callers can drop the real provider
 * in without changing the layer's signature.
 */
export const appleVisionProvider: VisionProvider = async (
  _book: BookInput,
) => {
  // Intentionally returns null: Vision is invoked from
  // the Python sidecar (PR-1), not from Node. Keeping
  // the default a no-op means the layer is safe to call
  // on any platform without crashing.
  return null
}

/**
 * Layer-5 entry point. Reads OCR text from the
 * configured provider and runs the same ISBN regex we
 * use in layer 2 — same shape, same checksum.
 */
export async function extractVisionOcrIsbn(
  book: BookInput,
  ctx: LayerContext & { provider?: VisionProvider },
): Promise<IsbnCandidate | null> {
  const provider = ctx.provider ?? appleVisionProvider
  try {
    const text = await provider(book)
    if (!text) return null
    // Reuse the layer-2 pure helper so the regex is
    // defined in exactly one place.
    const found = extractIsbnFromText(text) ?? normalizeIsbn(text)
    if (!found) return null
    return {
      isbn: found,
      source: 'vision-ocr',
      confidence: 0.7,
      raw: { text, provider: provider.name },
    }
  } catch {
    return null
  }
}
