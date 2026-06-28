import { buildBullMqConnection, BULLMQ_CONNECTION } from '../../src/workers/bullmq.config';

/**
 * Contract tests for the BullMQ Redis connection factory
 * (PR-2E, work unit 2).
 *
 *   - Builds a configured ioredis client from environment vars
 *     (REDIS_HOST / REDIS_PORT, default localhost:6379).
 *   - The same factory token (``BULLMQ_CONNECTION``) is used by
 *     ``WorkersModule`` so e2e tests can override it with a stub
 *     and skip the real Redis check.
 *   - The factory is synchronous and does not block on Redis
 *     availability — BullMQ's ``maxRetriesPerRequest: null`` is
 *     the documented default for the worker side and the factory
 *     must honour it.
 */

describe('buildBullMqConnection (Redis factory)', () => {
  const ORIGINAL_ENV = { ...process.env };

  function restoreEnv(): void {
    for (const key of Object.keys(process.env)) {
      if (!(key in ORIGINAL_ENV)) {
        delete process.env[key];
      }
    }
    for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
      process.env[k] = v;
    }
  }

  afterEach(() => {
    restoreEnv();
  });

  it('returns a client with host/port from the environment', () => {
    process.env.REDIS_HOST = 'redis.example.test';
    process.env.REDIS_PORT = '6390';
    const client = buildBullMqConnection();
    expect(client.options.host).toBe('redis.example.test');
    expect(client.options.port).toBe(6390);
    // Disconnect eagerly so the test does not leak the socket.
    client.disconnect();
  });

  it('falls back to localhost:6379 when no env vars are set', () => {
    delete process.env.REDIS_HOST;
    delete process.env.REDIS_PORT;
    const client = buildBullMqConnection();
    expect(client.options.host).toBe('localhost');
    expect(client.options.port).toBe(6379);
    client.disconnect();
  });

  it('configures BullMQ-required options (maxRetriesPerRequest: null, enableReadyCheck: false)', () => {
    const client = buildBullMqConnection();
    // BullMQ's docs require these for workers; the factory must
    // not let a caller override them with a less-permissive
    // setting.
    expect(client.options.maxRetriesPerRequest).toBeNull();
    expect(client.options.enableReadyCheck).toBe(false);
    client.disconnect();
  });

  it('exposes BULLMQ_CONNECTION as a string token for DI', () => {
    expect(typeof BULLMQ_CONNECTION).toBe('string');
    expect(BULLMQ_CONNECTION).toMatch(/BULLMQ_CONNECTION/);
  });
});
