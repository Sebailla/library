/**
 * Layer 6 of the 7-layer ISBN chain — Unlimited-OCR
 * (PR-4A, issue #71).
 *
 * Sends the rendered first page and back cover to the
 * optional Unlimited-OCR cloud endpoint (Baidu). The
 * endpoint is configured via:
 *  - `ctx.unlimitedOcrEndpoint` (preferred — set by the
 *    orchestrator / RSC)
 *  - `process.env.UNLIMITED_OCR_ENDPOINT` (fallback)
 *
 * Per the spec, the layer is skipped silently when the
 * endpoint is unset or unreachable. Skipping is `null`,
 * not an error — the chain moves to layer 7.
 *
 * The layer uses the `fetch` injected via `LayerContext`
 * so tests do not need a live endpoint; the production
 * default is `globalThis.fetch`.
 */

import type { BookInput, IsbnCandidate, LayerContext } from '../types'
import { normalizeIsbn } from '../validate'

/** Env-var name; the orchestrator may also pass it via context. */
const ENV_VAR = 'UNLIMITED_OCR_ENDPOINT'

/**
 * Layer-6 entry point. Returns the ISBN from the
 * Unlimited-OCR response, or `null` when the endpoint
 * is unset, unreachable, or returns no ISBN.
 */
export async function extractUnlimitedOcrIsbn(
  book: BookInput,
  ctx: LayerContext,
): Promise<IsbnCandidate | null> {
  const endpoint =
    ctx.unlimitedOcrEndpoint ?? process.env[ENV_VAR] ?? ''
  if (!endpoint) return null
  try {
    const fetcher = ctx.fetch ?? globalThis.fetch
    const res = await fetcher(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: book.title,
        author: book.author,
        filePath: book.filePath,
      }),
    })
    if (!res.ok) return null
    const body = (await res.json()) as { isbn?: string | null }
    const candidate = body.isbn
    if (!candidate) return null
    const normalized = normalizeIsbn(candidate)
    if (!normalized) return null
    return {
      isbn: normalized,
      source: 'unlimited-ocr',
      confidence: 0.7,
      raw: { body, endpoint },
    }
  } catch {
    return null
  }
}
