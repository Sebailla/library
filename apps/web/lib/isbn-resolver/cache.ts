/**
 * In-memory ISBN cache (PR-4A, issue #71).
 *
 * A `Map<string, IsbnCandidate>` keyed by a normalized
 * composite of `(title, author, format)`. The cache is
 * process-local; it does not survive a process restart
 * and it is not shared between the Next.js dev server
 * and a worker process. That is acceptable for this
 * scope — the persistent store is the
 * `isbn_resolutions` table in Postgres (PR-2), and the
 * next process boot will repopulate the cache from
 * successful lookups.
 *
 * Why normalize the key? OpenLibrary + Google Books
 * matching is fuzzy; we want the cache to be
 * case- and whitespace-insensitive so `"Ficciones"`,
 * `"ficciones"`, and `"  Ficciones  "` all hit the
 * same entry. Authors are part of the key (same title
 * by two authors must NOT collide) but missing author
 * is treated as the empty string so
 * `{title:"X", format:"pdf"}` and
 * `{title:"X", author:"", format:"pdf"}` collapse.
 *
 * Failed lookups are NOT cached. The cache MUST only
 * hold successful `IsbnCandidate` values; if a layer
 * returns `null` we do not write anything.
 */

import type { CacheKey, IsbnCache, IsbnCandidate } from './types'

/**
 * Normalize a composite key to its canonical string form:
 *  - trim and lowercase the title, author, and format
 *  - collapse internal whitespace
 *  - treat missing/empty author as the empty string
 */
export function normalizeCacheKey(key: CacheKey): string {
  const t = (key.title ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  const a = (key.author ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  const f = (key.format ?? '').trim().toLowerCase()
  return `${t}::${a}::${f}`
}

/**
 * Construct a fresh, empty in-memory cache. Each call
 * returns an independent `Map`, so tests do not share
 * state and a process can build a cache per request if
 * it needs to.
 */
export function createInMemoryIsbnCache(): IsbnCache {
  const store = new Map<string, IsbnCandidate>()

  return {
    get(key: CacheKey): IsbnCandidate | null {
      return store.get(normalizeCacheKey(key)) ?? null
    },
    set(key: CacheKey, candidate: IsbnCandidate): void {
      store.set(normalizeCacheKey(key), candidate)
    },
  }
}
