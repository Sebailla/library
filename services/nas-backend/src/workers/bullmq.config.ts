import IORedis, { Redis, RedisOptions } from 'ioredis';
import type { JobsOptions } from 'bullmq';

/**
 * String token used to inject the configured BullMQ Redis client
 * into the NestJS DI graph. E2e tests can override it with a stub
 * to skip the real Redis dependency.
 */
export const BULLMQ_CONNECTION = 'BULLMQ_CONNECTION';

/**
 * Shared BullMQ queue options (4R review #35, issue #98).
 *
 *   - ``attempts: 3`` with exponential 5s backoff lets transient
 *     spawn failures (Redis blip, momentary CPU pressure) recover
 *     before the job is moved to the failed set.
 *   - ``removeOnComplete`` keeps the completed set bounded so a
 *     long-running queue does not grow unbounded; 1h of history is
 *     enough for operators to inspect recent runs.
 *   - ``removeOnFail`` keeps failed jobs for 24h so an operator
 *     has a full day to triage before BullMQ reaps them.
 *
 * This is the single source of truth for the retry budget. The
 * same factory is consumed by:
 *
 *   - {@link WorkersBootstrap} — the ``scan`` + ``downloads`` +
 *     ``admin-scan`` workers read ``removeOnComplete``,
 *     ``removeOnFail`` from the result.
 *   - {@link getScanProducerDefaultJobOptions} — the
 *     ``admin-scan`` producer's ``Queue.defaultJobOptions``.
 *
 * A typo or value change in this factory propagates to both
 * sides automatically. No literal retry values should exist
 * anywhere else in the codebase.
 *
 * The factory is exposed as a free function (not a constant) so
 * tests can assert against the same object the wiring uses
 * without reaching into module internals.
 */
export function buildQueueOptions(): {
  attempts: number;
  backoff: { type: 'exponential'; delay: number };
  removeOnComplete: { age: number; count: number };
  removeOnFail: { age: number };
} {
  return {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { age: 86400 },
  };
}

/**
 * BullMQ producer default job options the admin scan module
 * consumes. The helper exists so the producer wiring +
 * {@link buildQueueOptions} share the same call path; both the
 * runtime factory AND the unit test reach the value through the
 * same function, so the test cannot drift from production.
 *
 * Issue #98 — the producer previously inlined the four retry
 * literals, allowing the worker-side factory to desync
 * silently. The helper collapses both sides onto the same
 * source of truth.
 */
export function getScanProducerDefaultJobOptions(): JobsOptions {
  return buildQueueOptions();
}

/**
 * Build a configured ``ioredis`` client for BullMQ.
 *
 * BullMQ workers require two specific options that the bare
 * ``ioredis`` constructor does not set:
 *
 *   - ``maxRetriesPerRequest: null`` — BullMQ's docs require this
 *     for the worker side; otherwise blocking commands throw
 *     ``MaxRetriesPerRequestError`` and the worker never recovers.
 *   - ``enableReadyCheck: false`` — workers run inside a container
 *     with potentially no DNS for the Redis sentinel name during
 *     boot; disabling the ready check lets the worker start before
 *     Redis is reachable and reconnect in the background.
 *
 * The factory is intentionally synchronous and does not block on
 * Redis availability — workers that boot before Redis is ready
 * will queue jobs but not fail.
 */
export function buildBullMqConnection(options: Partial<RedisOptions> = {}): Redis {
  const host = options.host ?? process.env.REDIS_HOST ?? 'localhost';
  const port = options.port ?? Number(process.env.REDIS_PORT ?? 6379);
  return new IORedis({
    host,
    port,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
    // Keep the default 50ms backoff so we don't hammer the broker
    // when it bounces during a deploy.
    retryStrategy: (times: number) => Math.min(times * 50, 2_000),
    ...options,
  });
}
