/**
 * Layer 7 of the 7-layer ISBN chain — national libraries
 * (PR-4A, issue #71).
 *
 * Asks the configured national libraries for a fuzzy
 * match by title + author. The supported providers in
 * PR-4A are:
 *  - Library of Congress  (id: 'loc')
 *  - Biblioteca Nacional de España  (id: 'bne')
 *  - Biblioteca Nacional de la República Argentina
 *    (id: 'bn-argentina')
 *
 * The layer tries them in a fixed order and returns the
 * first checksum-valid ISBN. Each provider exposes a
 * `lookup` endpoint; the URL is configured per
 * deployment via the `nationalLibraryEndpoints` map
 * in `LayerContext` (or, for the production defaults,
 * via env vars — see the orchestrator).
 *
 * A 5xx, a thrown error, or a missing endpoint all
 * collapse to "skip this provider, try the next one"
 * — the layer never throws.
 *
 * The 0.6 confidence reflects the fact that this is
 * the lowest-trust layer: the file has nothing, the
 * upstream APIs returned nothing structured, and we
 * are pulling from a national library catalog.
 */

import type { BookInput, IsbnCandidate, LayerContext, NationalLibraryId } from '../types'
import { normalizeIsbn } from '../validate'

/** Provider order — fixed. LoC is tried first, BNE second, etc. */
const PROVIDER_ORDER: readonly NationalLibraryId[] = [
  'loc',
  'bne',
  'bn-argentina',
] as const

/** Each provider's POST body shape is identical for PR-4A. */
interface ProviderRequest {
  title: string
  author?: string
}

interface ProviderResponse {
  isbn?: string | null
}

/**
 * Layer-7 entry point. Tries each configured provider in
 * order and returns the first valid ISBN, or `null`.
 */
export async function extractNationalLibrariesIsbn(
  book: BookInput,
  ctx: LayerContext,
): Promise<IsbnCandidate | null> {
  const endpoints = ctx.nationalLibraryEndpoints ?? {}
  for (const id of PROVIDER_ORDER) {
    const endpoint = endpoints[id]
    if (!endpoint) continue
    const found = await queryProvider(id, endpoint, book, ctx)
    if (found) return found
  }
  return null
}

async function queryProvider(
  id: NationalLibraryId,
  endpoint: string,
  book: BookInput,
  ctx: LayerContext,
): Promise<IsbnCandidate | null> {
  try {
    const fetcher = ctx.fetch ?? globalThis.fetch
    const res = await fetcher(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildRequest(book)),
    })
    if (!res.ok) return null
    const body = (await res.json()) as ProviderResponse
    const candidate = body.isbn
    if (!candidate) return null
    const normalized = normalizeIsbn(candidate)
    if (!normalized) return null
    return {
      isbn: normalized,
      source: 'national-libraries',
      confidence: 0.6,
      raw: { provider: id, body, endpoint },
    }
  } catch {
    return null
  }
}

function buildRequest(book: BookInput): ProviderRequest {
  return {
    title: book.title,
    ...(book.author ? { author: book.author } : {}),
  }
}
