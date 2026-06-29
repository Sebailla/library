/**
 * Layer 3 of the 7-layer ISBN chain — OpenLibrary search
 * (PR-4A, issue #71).
 *
 * When the file does not expose its ISBN, we ask
 * OpenLibrary for a hit by title + author:
 *
 *   GET https://openlibrary.org/search.json?q=<title> <author>&limit=5
 *
 * The first hit that carries a checksum-valid ISBN wins.
 * The `fetch` is injected via `LayerContext.fetch` so
 * tests do not need a live network; the production
 * default is `globalThis.fetch`.
 *
 * The layer NEVER throws. A network error, a 5xx
 * response, or an empty `docs[]` all collapse to `null`
 * so the chain can fall through to the next layer.
 *
 * The 0.8 confidence reflects the fact that the ISBN came
 * from a fuzzy match — the file did not declare it
 * itself. Layers that are closer to the source (embedded
 * = 1.0, regex = 0.9) outrank this one when their
 * results disagree.
 */

import type { BookInput, IsbnCandidate, LayerContext } from '../types'
import { normalizeIsbn } from '../validate'

/** OpenLibrary base URL — exposed as a constant for tests. */
export const OPENLIBRARY_BASE = 'https://openlibrary.org'

/** How many results to ask OpenLibrary for. */
const RESULT_LIMIT = 5

/**
 * Shape of a single OpenLibrary search hit. We only read
 * the fields we need; OpenLibrary's actual response
 * contains dozens more.
 */
interface OpenLibraryHit {
  title?: string
  author_name?: string[]
  isbn?: string[]
}

interface OpenLibraryResponse {
  numFound?: number
  docs?: OpenLibraryHit[]
}

/**
 * Layer-3 entry point. Returns the ISBN from the first
 * OpenLibrary hit that carries a valid ISBN, or `null`.
 */
export async function extractOpenLibraryIsbn(
  book: BookInput,
  ctx: LayerContext,
): Promise<IsbnCandidate | null> {
  const query = buildQuery(book)
  if (!query) return null
  const url = `${OPENLIBRARY_BASE}/search.json?q=${encodeURIComponent(
    query,
  )}&limit=${RESULT_LIMIT}`
  try {
    const fetcher = ctx.fetch ?? globalThis.fetch
    const res = await fetcher(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return null
    const body = (await res.json()) as OpenLibraryResponse
    const first = body.docs?.find((d) => d.isbn && d.isbn.length > 0)
    if (!first || !first.isbn) return null
    for (const candidate of first.isbn) {
      const normalized = normalizeIsbn(candidate)
      if (normalized) {
        return {
          isbn: normalized,
          source: 'openlibrary',
          confidence: 0.8,
          raw: { hit: first, query },
        }
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Compose the OpenLibrary `q` parameter from title and
 * author. The author's last word is appended so the
 * result is "Ficciones Borges" rather than just
 * "Ficciones" — enough to disambiguate common titles
 * without being too strict. We use the last word because
 * Western author names put the surname last; for a
 * mononym ("Plato") it is the only word, so the rule
 * works for both cases.
 */
function buildQuery(book: BookInput): string {
  const title = (book.title ?? '').trim()
  if (!title) return ''
  const author = (book.author ?? '').trim()
  if (!author) return title
  const words = author.split(/\s+/)
  const lastWord = words[words.length - 1] ?? ''
  return lastWord ? `${title} ${lastWord}` : title
}
