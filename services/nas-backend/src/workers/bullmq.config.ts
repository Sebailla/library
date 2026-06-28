import IORedis, { Redis, RedisOptions } from 'ioredis';

/**
 * String token used to inject the configured BullMQ Redis client
 * into the NestJS DI graph. E2e tests can override it with a stub
 * to skip the real Redis dependency.
 */
export const BULLMQ_CONNECTION = 'BULLMQ_CONNECTION';

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
