/**
 * ISBN resolution pipeline — public surface (PR-4A, #71).
 *
 * Re-exports every public type and function so callers
 * can write
 *
 *   import { resolve, createInMemoryIsbnCache, createIsbnResolver } from '@/lib/isbn-resolver'
 *
 * without learning the internal file layout. Also
 * exposes a `createIsbnResolver` factory that bundles
 * a default cache + 7-layer chain so most callers do
 * not need to know about `ResolveDeps` at all.
 *
 * The factory is the recommended entry point. Direct
 * `resolve` callers should only do so when they need
 * to wire a custom cache / custom layers (tests, batch
 * jobs, etc.).
 */

import { createInMemoryIsbnCache, type IsbnCache } from './cache'
import { resolve, type ResolveDeps } from './resolve'
import type { BookInput, BookMetadata } from './types'

export {
  isValidIsbn10,
  isValidIsbn13,
  normalizeIsbn,
  isbn10ToIsbn13,
} from './validate'

export {
  createInMemoryIsbnCache,
  normalizeCacheKey,
  type IsbnCache,
} from './cache'

export {
  resolve,
  resolveCached,
  type ResolveDeps,
} from './resolve'

export type {
  BookInput,
  BookMetadata,
  CacheKey,
  IsbnCandidate,
  Layer,
  LayerContext,
  NationalLibraryId,
  ResolutionLayer,
} from './types'

export { LAYER_ORDER } from './types'

// Re-export the individual layer entry points so advanced
// callers can run a single layer or compose their own
// chain. Tests do not import from here — they go straight
// to `./layers/*` — but production callers building a
// custom ResolveDeps will.
export { extractEmbeddedIsbn, scanOpfForIsbn } from './layers/embedded'
export { extractRegexIsbn, extractIsbnFromText } from './layers/regex'
export { extractOpenLibraryIsbn, OPENLIBRARY_BASE } from './layers/openlibrary'
export { extractGoogleBooksIsbn, GOOGLE_BOOKS_BASE } from './layers/google-books'
export {
  extractVisionOcrIsbn,
  appleVisionProvider,
  type VisionProvider,
} from './layers/vision-ocr'
export { extractUnlimitedOcrIsbn } from './layers/unlimited-ocr'
export { extractNationalLibrariesIsbn } from './layers/national-libraries'

/**
 * Handle to a pre-wired resolver. Holds the cache and
 * the deps so callers can call `handle.resolve(book)`
 * without re-supplying them.
 */
export interface IsbnResolver {
  /** Run the chain for `book`, return a BookMetadata or null. */
  resolve(book: BookInput): Promise<BookMetadata | null>
  /** Underlying cache. Exposed for batch operations. */
  cache: IsbnCache
  /** Underlying deps. Exposed for tests + advanced wiring. */
  deps: ResolveDeps
}

/**
 * Construct a ready-to-use ISBN resolver. Most callers
 * should use this factory. It bundles a default
 * `IsbnCache` and the spec-mandated 7-layer chain; you
 * can override any field by passing `partial`.
 */
export function createIsbnResolver(
  partial: Partial<ResolveDeps> = {},
): IsbnResolver {
  const cache = partial.cache ?? createInMemoryIsbnCache()
  const deps: ResolveDeps = { ...partial, cache }
  return {
    cache,
    deps,
    async resolve(book: BookInput): Promise<BookMetadata | null> {
      return resolve(book, deps)
    },
  }
}
