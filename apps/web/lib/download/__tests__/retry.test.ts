import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

import { withRetry, type RetryOptions } from '../retry'

/**
 * TDD tests for `lib/download/retry.ts` (PR-3-fix-B, issue #62).
 *
 * `withRetry(fn, { attempts, backoff, baseMs })` runs `fn` up to
 * `attempts` times, retrying on rejection. The default config is
 * 3 attempts with exponential backoff (250 ms, 500 ms, 1000 ms,
 * …). Tests cover the four contracts:
 *
 *   1. resolves with the value on first-attempt success
 *   2. resolves with the value on eventual success after N
 *      transient failures
 *   3. rejects with the LAST error when all attempts fail
 *   4. respects `shouldRetry` predicate (don't retry on
 *      programmer errors)
 *   5. exponential backoff increases the wait between attempts
 *      (linear backoff does NOT)
 */

describe('withRetry (PR-3-fix-B, #62)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves with the value on first-attempt success', async () => {
    const fn = vi.fn(async () => 'ok')
    const result = await withRetry(fn)
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries transient failures up to attempts times then resolves', async () => {
    let attempts = 0
    const fn = vi.fn(async () => {
      attempts += 1
      if (attempts < 3) throw new Error(`transient ${attempts}`)
      return 'finally'
    })
    // The retry helper backs off between attempts; fast-forward
    // through each backoff window so the test doesn't actually
    // wait. `vi.advanceTimersByTimeAsync` walks the timer queue.
    const promise = withRetry(fn, { attempts: 3, backoff: 'exp', baseMs: 10 })
    // Drive the microtask + timer queue:
    await vi.runAllTimersAsync()
    const result = await promise
    expect(result).toBe('finally')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('rejects with the LAST error when all attempts fail', async () => {
    const fn = vi.fn(async () => {
      throw new Error('always fails')
    })
    const promise = withRetry(fn, { attempts: 3, backoff: 'exp', baseMs: 10 })
    promise.catch(() => {
      /* swallow unhandled rejection until we await below */
    })
    await vi.runAllTimersAsync()
    await expect(promise).rejects.toThrow(/always fails/)
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('does NOT retry when shouldRetry returns false', async () => {
    const fn = vi.fn(async () => {
      throw new Error('programmer error')
    })
    const shouldRetry = vi.fn((err: unknown) => !/programmer/.test(String(err)))
    await expect(
      withRetry(fn, { attempts: 5, backoff: 'exp', baseMs: 10, shouldRetry }),
    ).rejects.toThrow(/programmer error/)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(shouldRetry).toHaveBeenCalledTimes(1)
  })

  it('exponential backoff grows the wait between attempts', async () => {
    const waits: number[] = []
    const fn = vi.fn(async () => {
      throw new Error('fail')
    })
    // Inject a `setTimeout` that records the requested delays
    // and resolves the handler on the next microtick — no real
    // timer, no vi fake timer needed.
    const fakeSetTimeout = ((
      handler: () => void,
      ms?: number,
    ): unknown => {
      waits.push(ms ?? 0)
      // Fire on the microtask queue so the loop progresses
      // without ever blocking on a real timer.
      Promise.resolve().then(() => handler())
      return 0 as unknown as NodeJS.Timeout
    }) as unknown as typeof setTimeout

    await expect(
      withRetry(fn, {
        attempts: 3,
        backoff: 'exp',
        baseMs: 100,
        setTimeout: fakeSetTimeout,
      }),
    ).rejects.toThrow(/fail/)
    // 3 attempts → 2 backoff windows. baseMs=100 → 100ms then 200ms.
    expect(waits).toEqual([100, 200])
  })

  it('linear backoff uses a constant delay', async () => {
    const waits: number[] = []
    const fn = vi.fn(async () => {
      throw new Error('fail')
    })
    const fakeSetTimeout = ((
      handler: () => void,
      ms?: number,
    ): unknown => {
      waits.push(ms ?? 0)
      Promise.resolve().then(() => handler())
      return 0 as unknown as NodeJS.Timeout
    }) as unknown as typeof setTimeout

    await expect(
      withRetry(fn, {
        attempts: 3,
        backoff: 'linear',
        baseMs: 50,
        setTimeout: fakeSetTimeout,
      } satisfies RetryOptions),
    ).rejects.toThrow(/fail/)
    expect(waits).toEqual([50, 50])
  })
})