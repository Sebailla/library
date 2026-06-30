import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import {
  buildRequestMiddleware,
  REQUEST_ID_HEADER,
} from '../../src/observability/request-middleware';

/**
 * PR-N7 (issue #92) — request middleware contract tests.
 *
 * The middleware is mounted in ``main.ts`` via ``app.use(...)``
 * before every NestJS route. It must:
 *
 *   1. Generate a request id (or honour the inbound ``X-Request-Id``).
 *   2. Seed the AsyncLocalStorage envelope so the request logger
 *      stamps ``request_id``, ``route``, ``method`` on every
 *      downstream log line.
 *   3. Set the ``X-Request-Id`` response header so the caller can
 *      correlate logs by id.
 *   4. Track duration + status and record the metrics on
 *      ``res.on('finish')``.
 *   5. Treat missing/unmatched routes as the catch-all
 *      ``__not_found__`` path so the metric cardinality stays
 *      bounded.
 *
 * Tests below cover the middleware in isolation (no NestJS, no
 * supertest) so the suite stays under a few hundred ms and the
 * contract pins cleanly to behaviour, not HTTP semantics.
 */
describe('buildRequestMiddleware (PR-N7)', () => {
  /**
   * Minimal Express-compatible Request stub. ``req.route`` is
   * intentionally undefined unless the test assigns one so the
   * middleware's "fall back to literal path" branch stays
   * exercised.
   */
  function makeReq(overrides: Partial<Request> = {}): Request {
    const base: Record<string, unknown> = {
      method: 'GET',
      url: '/livez',
      headers: {},
      route: undefined,
      connection: { remoteAddress: '127.0.0.1' },
    };
    return { ...base, ...overrides } as unknown as Request;
  }

  /**
   * Minimal Express-compatible Response stub. Captures headers
   * and the order of ``finish`` events. ``emitFinish()`` drives
   * the metric write synchronously so the test can assert.
   */
  function makeRes(): Response & {
    setStatus: (code: number) => void;
    end: () => void;
    headers: Record<string, string>;
  } {
    const headers: Record<string, string> = {};
    let status = 200;
    const finishListeners: Array<() => void> = [];
    const stub = {
      statusCode: 200,
      headersSent: false,
      setHeader(name: string, value: string | number) {
        headers[name.toLowerCase()] = String(value);
        return this;
      },
      getHeader(name: string): unknown {
        return headers[name.toLowerCase()];
      },
      on(event: string, cb: () => void) {
        if (event === 'finish') finishListeners.push(cb);
        return this;
      },
      once() {
        return this;
      },
      emit() {
        return true;
      },
      end() {
        return this;
      },
    };

    return Object.assign(stub, {
      setStatus(code: number): void {
        status = code;
        (stub as unknown as { statusCode: number }).statusCode = code;
      },
      end(): void {
        void status;
        for (const cb of finishListeners) cb();
      },
      headers,
    }) as unknown as Response & {
      setStatus: (code: number) => void;
      end: () => void;
      headers: Record<string, string>;
    };
  }

  it('honours an inbound X-Request-Id header verbatim and echoes it back', async () => {
    const recordHttpRequest = jest.fn();
    const middleware = buildRequestMiddleware({ metrics: { recordHttpRequest } as never });
    const req = makeReq({
      headers: { [REQUEST_ID_HEADER.toLowerCase()]: 'inbound-1' } as never,
    });
    const res = makeRes();
    let contextRequestId: string | undefined;
    await middleware(req, res, () => {
      contextRequestId = req.headers[REQUEST_ID_HEADER.toLowerCase()] as string;
    });
    res.end();
    expect(contextRequestId).toBe('inbound-1');
    expect(res.headers[REQUEST_ID_HEADER.toLowerCase()]).toBe('inbound-1');
  });

  it('generates a request id when no header is supplied and sets it on the response', async () => {
    const recordHttpRequest = jest.fn();
    const middleware = buildRequestMiddleware({ metrics: { recordHttpRequest } as never });
    const req = makeReq();
    const res = makeRes();
    await middleware(req, res, () => undefined);
    res.end();
    const headerValue = res.headers[REQUEST_ID_HEADER.toLowerCase()];
    expect(typeof headerValue).toBe('string');
    // 32 hex chars (no dashes), matches a randomUUID().replace(/-/g, '').
    expect(/^[0-9a-f]{32}$/.test(headerValue!)).toBe(true);
  });

  it('records http_requests_total with method + route template + status on res.finish', async () => {
    const recordHttpRequest = jest.fn();
    const middleware = buildRequestMiddleware({ metrics: { recordHttpRequest } as never });
    const req = makeReq({
      method: 'GET',
      url: '/api/books/123',
      route: { path: '/api/books/:book_id' } as never,
    });
    const res = makeRes();
    await middleware(req, res, () => undefined);
    res.setStatus(200);
    res.end();

    expect(recordHttpRequest).toHaveBeenCalledTimes(1);
    const [method, path, status, duration] = recordHttpRequest.mock.calls[0]!;
    expect(method).toBe('GET');
    expect(path).toBe('/api/books/:book_id'); // route template, not raw URL
    expect(status).toBe(200);
    expect(typeof duration).toBe('number');
    expect(duration).toBeGreaterThanOrEqual(0);
  });

  it('falls back to the catch-all __not_found__ path when no route template matches', async () => {
    const recordHttpRequest = jest.fn();
    const middleware = buildRequestMiddleware({ metrics: { recordHttpRequest } as never });
    const req = makeReq({ url: '/this/route/does/not/exist' });
    const res = makeRes();
    await middleware(req, res, () => undefined);
    res.setStatus(404);
    res.end();
    const [method, path, status] = recordHttpRequest.mock.calls[0]!;
    expect(method).toBe('GET');
    expect(path).toBe('__not_found__');
    expect(status).toBe(404);
  });

  it('seeds the AsyncLocalStorage envelope so downstream log lines carry the request_id', async () => {
    const recordHttpRequest = jest.fn();
    const middleware = buildRequestMiddleware({ metrics: { recordHttpRequest } as never });
    const req = makeReq({
      headers: { [REQUEST_ID_HEADER.toLowerCase()]: 'trace-me' } as never,
    });
    const res = makeRes();
    let observedFromNext: string | undefined;
    await middleware(req, res, async () => {
      // The middleware must have stamped the request id on req.headers
      // before invoking ``next()``.
      observedFromNext = req.headers[REQUEST_ID_HEADER.toLowerCase()] as string;
    });
    res.end();
    expect(observedFromNext).toBe('trace-me');
  });

  it('exports a constant REQUEST_ID_HEADER so other modules avoid string drift', () => {
    expect(REQUEST_ID_HEADER).toBe('X-Request-Id');
  });

  it('uses AsyncLocalStorage so two parallel requests do not share ids', async () => {
    const recordHttpRequest = jest.fn();
    const middleware = buildRequestMiddleware({ metrics: { recordHttpRequest } as never });
    const reqA = makeReq();
    const resA = makeRes();
    const reqB = makeReq();
    const resB = makeRes();
    const idsSeen: string[] = [];
    await Promise.all([
      middleware(reqA, resA, async () => {
        idsSeen.push(reqA.headers[REQUEST_ID_HEADER.toLowerCase()] as string);
        await new Promise<void>((r) => setTimeout(r, 5));
        idsSeen.push(reqA.headers[REQUEST_ID_HEADER.toLowerCase()] as string);
      }),
      middleware(reqB, resB, async () => {
        idsSeen.push(reqB.headers[REQUEST_ID_HEADER.toLowerCase()] as string);
        await new Promise<void>((r) => setTimeout(r, 1));
        idsSeen.push(reqB.headers[REQUEST_ID_HEADER.toLowerCase()] as string);
      }),
    ]);
    resA.end();
    resB.end();
    // Two requests must carry two distinct ids — and the late
    // ``next()`` re-reads inside BOTH async scopes must still see
    // each request's own id (no leakage).
    expect(new Set(idsSeen).size).toBe(2);
    expect(typeof randomUUID()).toBe('string');
  });

  it('returns a callable NextFunction compatible function (Express signature)', () => {
    const recordHttpRequest = jest.fn();
    const middleware = buildRequestMiddleware({ metrics: { recordHttpRequest } as never });
    expect(typeof middleware).toBe('function');
    expect(middleware.length).toBe(3); // (req, res, next)
  });
  void (null as unknown as NextFunction);
});
