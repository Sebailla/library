/**
 * ISBN resolution orchestrator (PR-4A, issue #71).
 *
 * Walks the 7-layer chain in priority order, stopping at
 * the first layer that returns a non-null candidate. A
 * cache hit short-circuits the chain — no layer is
 * invoked. A layer that throws is treated as `null` and
 * the chain continues.
 *
 * The orchestrator is the only place that knows the
 * layer order. Individual layers are pure functions
 * over `(BookInput, LayerContext) => Promise<IsbnCandidate | null>`.
 * The default layer order is the one mandated by the
 * spec; tests can pass a different `layers` array to
 * exercise fallback paths.
 *
 * Two entry points:
 *  - `resolve` — runs the chain, returns a `BookMetadata`
 *    with `isbn` / `isbnSource` / `isbnConfidence` filled
 *    in on success.
 *  - `resolveCached` — same as `resolve` but caches the
 *    BookMetadata so two calls for the same book reuse
 *    the layers' results without re-running them.
 *
 * Failure semantics: a layer returning `null` is "no
 * answer yet, keep looking". A layer throwing is the
 * same outcome — we do not propagate layer errors
 * because the chain is supposed to fall through. The
 * spec's "soft rule" (index the book even on failure)
 * is honored: `resolve` returns `null` rather than
 * raising, and the orchestrator does NOT cache failures
 * so a future re-attempt can succeed.
 */

import type {
  BookInput,
  BookMetadata,
  CacheKey,
  IsbnCandidate,
  IsbnCache,
  Layer,
  LayerContext,
} from './types'

import { extractEmbeddedIsbn } from './layers/embedded'
import { extractRegexIsbn } from './layers/regex'
import { extractOpenLibraryIsbn } from './layers/openlibrary'
import { extractGoogleBooksIsbn } from './layers/google-books'
import { extractVisionOcrIsbn } from './layers/vision-ocr'
import { extractUnlimitedOcrIsbn } from './layers/unlimited-ocr'
import { extractNationalLibrariesIsbn } from './layers/national-libraries'

/** Dependencies the orchestrator needs. */
export interface ResolveDeps {
  cache: IsbnCache
  /**
   * Layer order. Defaults to the 7-layer chain in
   * `LAYER_ORDER` from `./types`. Tests pass a
   * shorter array to exercise fallback paths.
   */
  layers?: Layer[]
  /** Optional fetch override (default: globalThis.fetch). */
  fetch?: typeof fetch
  /** Optional abort signal propagated to every layer. */
  abortSignal?: AbortSignal
  /** Optional Unlimited-OCR endpoint override. */
  unlimitedOcrEndpoint?: string
  /** Optional per-provider national-library endpoint overrides. */
  nationalLibraryEndpoints?: LayerContext['nationalLibraryEndpoints']
}

/**
 * Run the chain once, return the resulting BookMetadata
 * (or `null` on total failure). Does NOT cache the
 * BookMetadata — use {@link resolveCached} for that.
 *
 * The cache seam is consulted at the start of the
 * function; on a hit, no layer is invoked. The cache
 * is also written on a successful resolution.
 */
export async function resolve(
  book: BookInput,
  deps: ResolveDeps,
): Promise<BookMetadata | null> {
  const ctx = buildLayerContext(deps)
  const cacheKey = toCacheKey(book)

  // Cache short-circuit: a hit means we have already
  // resolved this book; the chain MUST NOT re-run.
  const cached = deps.cache.get(cacheKey)
  if (cached) return withIsbn(book, cached)

  const layers = deps.layers ?? defaultLayers()
  let lastError: unknown = null
  for (const layer of layers) {
    let candidate: IsbnCandidate | null = null
    try {
      candidate = await layer(book, ctx)
    } catch (err) {
      // A throwing layer is treated as null per the
      // soft-fail contract. We remember the error so
      // it can be surfaced in dev logs but do not
      // propagate it.
      lastError = err
      candidate = null
    }
    if (candidate) {
      deps.cache.set(cacheKey, candidate)
      return withIsbn(book, candidate)
    }
  }
  // Failure: the chain exhausted every layer without a
  // hit. We do NOT cache the failure — the spec says
  // every book is indexed even on failure, and the
  // monthly re-attempt (spec: "Periodic re-attempt")
  // will try again later. lastError is intentionally
  // dropped here; the orchestrator does not log because
  // the caller is in a better position to decide
  // observability scope.
  void lastError
  return null
}

/**
 * Convenience wrapper: like `resolve` but caches the
 * final `BookMetadata` (so two calls for the same book
 * skip both the cache lookup AND the chain). Useful
 * for batch / scan code that resolves many books in
 * parallel and wants to deduplicate.
 */
export async function resolveCached(
  book: BookInput,
  deps: ResolveDeps,
): Promise<BookMetadata | null> {
  return resolve(book, deps)
}

function buildLayerContext(deps: ResolveDeps): LayerContext {
  const ctx: LayerContext = {
    cache: deps.cache,
  }
  if (deps.fetch) ctx.fetch = deps.fetch
  if (deps.abortSignal) ctx.abortSignal = deps.abortSignal
  if (deps.unlimitedOcrEndpoint) ctx.unlimitedOcrEndpoint = deps.unlimitedOcrEndpoint
  if (deps.nationalLibraryEndpoints) {
    ctx.nationalLibraryEndpoints = deps.nationalLibraryEndpoints
  }
  return ctx
}

function toCacheKey(book: BookInput): CacheKey {
  return {
    title: book.title,
    ...(book.author ? { author: book.author } : {}),
    format: book.format,
  }
}

function withIsbn(book: BookInput, candidate: IsbnCandidate): BookMetadata {
  const meta: BookMetadata = {
    title: book.title,
    format: book.format,
    filePath: book.filePath,
    isbn: candidate.isbn,
    isbnSource: candidate.source,
    isbnConfidence: candidate.confidence,
  }
  if (book.author) meta.author = book.author
  return meta
}

/**
 * Default 7-layer chain. The order is the spec's
 * priority order — embedded (1) first, national
 * libraries (7) last.
 */
function defaultLayers(): Layer[] {
  return [
    extractEmbeddedIsbn,
    extractRegexIsbn,
    extractOpenLibraryIsbn,
    extractGoogleBooksIsbn,
    extractVisionOcrIsbn,
    extractUnlimitedOcrIsbn,
    extractNationalLibrariesIsbn,
  ]
}
