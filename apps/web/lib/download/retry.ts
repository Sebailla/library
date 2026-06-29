/**
 * Bounded retry helper with exponential / linear backoff
 * (PR-3-fix-B, issue #62).
 *
 * The download flow (`lib/download/download-flow.ts`) hits four
 * NAS round-trip endpoints (`getBook`, `startDownload`,
 * `downloadFile`, `completeDownload`). A single 503 / 504 /
 * network drop leaves a tracking row open on the NAS. Wrapping
 * each step with `withRetry` retries transient failures with a
 * small backoff so the user gets a successful download instead
 * of a dangling row.
 *
 * Defaults: `attempts: 3`, `backoff: 'exp'`, `baseMs: 250`.
 * Three attempts means: try → wait 250 ms → try → wait 500 ms
 * → try → fail (total wall-clock ≤ 750 ms before surfacing the
 * last error).
 *
 * The helper is pure — no shared state, no module-level cache.
 * Tests inject a `setTimeout` spy to assert the exponential /
 * linear schedule without waiting on real timers.
 */

export type BackoffKind = 'exp' | 'linear'

export interface RetryOptions {
  /** Maximum number of attempts (default 3). Includes the first try. */
  attempts?: number
  /** Backoff strategy (default 'exp'). */
  backoff?: BackoffKind
  /** Base delay in ms (default 250). Doubled each attempt for 'exp'. */
  baseMs?: number
  /**
   * Predicate called with the rejected error. Return `false` to
   * stop retrying immediately (default: always retry).
   */
  shouldRetry?: (err: unknown) => boolean
  /**
   * Override for `setTimeout` (test seam). Defaults to
   * `globalThis.setTimeout`.
   */
  setTimeout?: typeof setTimeout
}

/**
 * Run `fn` with bounded retries and configurable backoff.
 *
 * Returns the resolved value of `fn` on any successful attempt.
 * On final failure (all attempts rejected, or `shouldRetry`
 * returned `false`) the promise rejects with the last error.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 3
  const backoff = options.backoff ?? 'exp'
  const baseMs = options.baseMs ?? 250
  const shouldRetry = options.shouldRetry ?? (() => true)
  const setTimeoutImpl = options.setTimeout ?? globalThis.setTimeout

  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (!shouldRetry(err)) throw err
      const isLast = attempt === attempts - 1
      if (isLast) break
      const delay = computeDelay(backoff, baseMs, attempt)
      await wait(setTimeoutImpl, delay)
    }
  }
  throw lastError
}

/**
 * Compute the backoff delay for the given attempt index.
 *
 * `attempt` is 0-based: the first retry uses index 0 (no
 * delay yet — caller hasn't looped). `linear` is constant;
 * `exp` doubles each step.
 */
function computeDelay(backoff: BackoffKind, baseMs: number, attempt: number): number {
  if (backoff === 'linear') return baseMs
  // exp: baseMs * 2^attempt
  return baseMs * Math.pow(2, attempt)
}

function wait(setTimeoutImpl: typeof setTimeout, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeoutImpl(() => resolve(), ms)
  })
}