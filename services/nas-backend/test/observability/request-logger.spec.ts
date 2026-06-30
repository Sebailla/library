import { RequestContext, requestContextStorage } from '../../src/observability/request-context';
import {
  buildRequestLogger,
  requestLogger,
} from '../../src/observability/request-logger';

/**
 * PR-N7 (issue #92) — structured logging contract tests.
 *
 * Two surfaces are pinned:
 *
 *   1. {@link requestContextStorage} — the AsyncLocalStorage
 *      instance that propagates the per-request
 *      ``{ request_id, route, method }`` envelope across async
 *      hops. Anything inside the storage's ``run()`` callback
 *      resolves the SAME context with {@link getRequestContext};
 *      outside, ``getRequestContext`` returns ``undefined``.
 *   2. {@link buildRequestLogger} — returns a Pino logger that
 *      binds the active context (if any) to every log line and
 *      falls back to a plain logger when no context is set
 *      (e.g. during bootstrap before the middleware runs).
 *
 * The middleware (wired in main.ts) uses these two together to
 * stamp ``request_id`` on every log line emitted during a request.
 * Stdlib `console.log` keeps a stable shape (``{ level, time, msg,
 * request_id, route, method, ... }``) for production.
 */
describe('requestContextStorage (AsyncLocalStorage per-request envelope)', () => {
  it('returns undefined when read outside a run() callback', () => {
    expect(RequestContext.get()).toBeUndefined();
  });

  it('propagates the context into async hops inside run()', async () => {
    await requestContextStorage.run({ request_id: 'r-1', route: '/x', method: 'GET' }, async () => {
      // Synchronous read.
      expect(RequestContext.get()).toEqual({
        request_id: 'r-1',
        route: '/x',
        method: 'GET',
      });
      // setTimeout hop — ALS MUST still return the context.
      await new Promise<void>((resolve) =>
        setTimeout(() => {
          expect(RequestContext.get()).toEqual({
            request_id: 'r-1',
            route: '/x',
            method: 'GET',
          });
          resolve();
        }, 1),
      );
      // Promise hop.
      await Promise.resolve().then(() => {
        expect(RequestContext.get()).toEqual({
          request_id: 'r-1',
          route: '/x',
          method: 'GET',
        });
      });
    });
  });

  it('isolates two parallel run() callbacks', async () => {
    const seen: Array<string | undefined> = [];
    await Promise.all([
      requestContextStorage.run({ request_id: 'a', route: '/a', method: 'GET' }, async () => {
        await new Promise<void>((r) => setTimeout(r, 5));
        seen.push(RequestContext.get()?.request_id);
      }),
      requestContextStorage.run({ request_id: 'b', route: '/b', method: 'POST' }, async () => {
        await new Promise<void>((r) => setTimeout(r, 1));
        seen.push(RequestContext.get()?.request_id);
      }),
    ]);
    expect(seen.sort()).toEqual(['a', 'b']);
  });
});

describe('buildRequestLogger — Pino with AsyncLocalStorage binding', () => {
  it('emits plain logs (no request_id) when no context is active', () => {
    const captured: string[] = [];
    const stream = {
      write: (chunk: string) => {
        captured.push(chunk);
        return true;
      },
    };
    const logger = buildRequestLogger({ level: 'info' }, stream);
    logger.info({ event: 'bootstrap' }, 'no-context');
    const line = JSON.parse(captured[0]!) as Record<string, unknown>;
    expect(line.event).toBe('bootstrap');
    expect(line.msg).toBe('no-context');
    // No request_id outside of a request.
    expect(line.request_id).toBeUndefined();
  });

  it('auto-stamps request_id + route + method on every log line emitted inside a request', () => {
    const captured: string[] = [];
    const stream = {
      write: (chunk: string) => {
        captured.push(chunk);
        return true;
      },
    };
    const logger = buildRequestLogger({ level: 'info' }, stream);
    requestContextStorage.run({ request_id: 'req-42', route: '/api/books', method: 'GET' }, () => {
      logger.info('fetched books');
      logger.warn({ event: 'slow_query' }, 'took too long');
    });
    const lines = captured.map((c) => JSON.parse(c) as Record<string, unknown>);
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line.request_id).toBe('req-42');
      expect(line.route).toBe('/api/books');
      expect(line.method).toBe('GET');
    }
    expect(lines[0]?.msg).toBe('fetched books');
    expect(lines[1]?.event).toBe('slow_query');
  });

  it('exports a singleton requestLogger for production code paths', () => {
    expect(requestLogger).toBeDefined();
    expect(typeof requestLogger.info).toBe('function');
    expect(typeof requestLogger.warn).toBe('function');
    expect(typeof requestLogger.error).toBe('function');
  });
});
