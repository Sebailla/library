/**
 * Layer 4 of the 7-layer ISBN chain — Google Books search
 * (PR-4A, issue #71).
 *
 * When OpenLibrary misses, we ask Google Books for a hit
 * by title + author:
 *
 *   GET https://www.googleapis.com/books/v1/volumes?q=<title> <author>
 *
 * Each item carries `volumeInfo.industryIdentifiers[]`
 * with `ISBN_13` and `ISBN_10` entries. We prefer the
 * ISBN_13 and fall back to ISBN_10 (which is normalized
 * to ISBN-13 by `normalizeIsbn`).
 *
 * The `fetch` is injected via `LayerContext.fetch` so
 * tests do not need a live network; the production
 * default is `globalThis.fetch`.
 *
 * The 0.75 confidence reflects the fact that this is
 * yet another fuzzy match — the chain should prefer
 * embedded (1.0) and regex (0.9) when those return a
 * hit, and OpenLibrary (0.8) when neither file-derived
 * source does.
 */

import type { BookInput, IsbnCandidate, LayerContext } from '../types'
import { normalizeIsbn } from '../validate'

/** Google Books base URL — exposed as a constant for tests. */
export const GOOGLE_BOOKS_BASE = 'https://www.googleapis.com/books/v1/volumes'

interface IndustryIdentifier {
  type?: string
  identifier?: string
}

interface GoogleBooksItem {
  id?: string
  volumeInfo?: {
    title?: string
    authors?: string[]
    industryIdentifiers?: IndustryIdentifier[]
  }
}

interface GoogleBooksResponse {
  totalItems?: number
  items?: GoogleBooksItem[]
}

/**
 * Layer-4 entry point. Returns the first checksum-valid
 * ISBN from the first item that has one, or `null`.
 */
export async function extractGoogleBooksIsbn(
  book: BookInput,
  ctx: LayerContext,
): Promise<IsbnCandidate | null> {
  const query = buildQuery(book)
  if (!query) return null
  const url = `${GOOGLE_BOOKS_BASE}?q=${encodeURIComponent(query)}`
  try {
    const fetcher = ctx.fetch ?? globalThis.fetch
    const res = await fetcher(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return null
    const body = (await res.json()) as GoogleBooksResponse
    const items = body.items ?? []
    for (const item of items) {
      const ids = item.volumeInfo?.industryIdentifiers ?? []
      // Prefer ISBN_13 over ISBN_10.
      const byType = (t: string) =>
        ids.find((id) => id.type === t && id.identifier)
      const isbn13 = byType('ISBN_13')
      if (isbn13?.identifier) {
        const normalized = normalizeIsbn(isbn13.identifier)
        if (normalized) {
          return {
            isbn: normalized,
            source: 'googlebooks',
            confidence: 0.75,
            raw: { item, query },
          }
        }
      }
      const isbn10 = byType('ISBN_10')
      if (isbn10?.identifier) {
        const normalized = normalizeIsbn(isbn10.identifier)
        if (normalized) {
          return {
            isbn: normalized,
            source: 'googlebooks',
            confidence: 0.7,
            raw: { item, query },
          }
        }
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Compose the Google Books `q` parameter from title +
 * author's last word. Same logic as the OpenLibrary
 * helper: a single surname is enough to disambiguate
 * common titles without locking onto false positives.
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
