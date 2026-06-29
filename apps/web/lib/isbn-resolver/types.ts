/**
 * ISBN resolution pipeline — types (PR-4A, issue #71).
 *
 * Seven-layer priority chain that resolves a canonical ISBN
 * for every book in the catalog. The pipeline stops at the
 * first layer that returns a non-null candidate; layers
 * further down the chain are NEVER invoked once an answer is
 * found.
 *
 * This module is pure type definitions + a small
 * `ResolutionLayer` string union. Concrete layer
 * implementations live in `./layers/*.ts`; the orchestrator
 * lives in `./resolve.ts`.
 *
 * Why a discriminated union instead of `enum`? TypeScript
 * erasable types compile to plain string literals, and
 * `ResolutionLayer` is consumed as a column in the
 * `isbn_resolutions` table (see PR-2) so we keep the
 * wire-format identical to the source code.
 */

/**
 * Identifier of the layer that produced a candidate. The
 * orchestrator writes this to `isbn_resolutions.source`
 * so re-runs can be audited and tuned.
 */
export type ResolutionLayer =
  | 'embedded'
  | 'regex'
  | 'openlibrary'
  | 'googlebooks'
  | 'vision-ocr'
  | 'unlimited-ocr'
  | 'national-libraries'
  | 'cache'

/**
 * A single ISBN candidate produced by one of the seven
 * layers. `confidence` is in the closed interval [0, 1]
 * and is purely informational; the orchestrator uses
 * layer priority, not confidence, to choose a winner.
 *
 * `raw` is the upstream payload that produced the ISBN
 * (OpenLibrary doc, Google Books volume, etc.) and is
 * stored alongside the row so the UI can show "why we
 * chose this ISBN".
 */
export interface IsbnCandidate {
  /** Normalized ISBN-13 (preferred) or ISBN-10. Always digits. */
  isbn: string
  source: ResolutionLayer
  /** [0, 1]. Higher is more confident. */
  confidence: number
  /** Upstream payload for audit / display. */
  raw?: unknown
}

/**
 * A canonical book record to be enriched. Mirrors the
 * extractor output shape from the Python sidecar (PR-1)
 * but is loose enough to be constructed from anywhere
 * (UI form, API, test fixture).
 */
export interface BookInput {
  title: string
  author?: string
  format: 'pdf' | 'epub' | string
  filePath: string
  /**
   * Optional pre-extracted text (first ~50k chars). When
   * present, the regex layer uses it directly; when
   * absent, the layer must extract from `filePath` on
   * its own. UI / fixture callers usually set this so
   * the resolver does not re-open the file twice.
   */
  textSnippet?: string
}

/** Minimal cache seam consumed by every layer. */
export interface IsbnCache {
  /** Returns the cached candidate, or `null` if absent. */
  get(key: CacheKey): IsbnCandidate | null
  /** Stores a candidate under `key`. */
  set(key: CacheKey, candidate: IsbnCandidate): void
}

/** Composite key derived from `(title, author, format)`. */
export interface CacheKey {
  title: string
  author?: string
  format: string
}

/**
 * Per-call context injected by the orchestrator. The cache
 * is always present; `fetch` and `abortSignal` are optional
 * so the layer signature stays the same regardless of
 * whether we are in a server component, a worker, or a
 * test.
 */
export interface LayerContext {
  cache: IsbnCache
  fetch?: typeof fetch
  abortSignal?: AbortSignal
}

/** A single resolution layer. */
export type Layer = (
  book: BookInput,
  ctx: LayerContext,
) => Promise<IsbnCandidate | null>

/** Full list of layers in priority order. */
export const LAYER_ORDER: readonly ResolutionLayer[] = [
  'embedded',
  'regex',
  'openlibrary',
  'googlebooks',
  'vision-ocr',
  'unlimited-ocr',
  'national-libraries',
] as const

/** Full book metadata after ISBN resolution. */
export interface BookMetadata {
  title: string
  author?: string
  format: string
  filePath: string
  isbn?: string
  isbnSource?: ResolutionLayer
  isbnConfidence?: number
}
