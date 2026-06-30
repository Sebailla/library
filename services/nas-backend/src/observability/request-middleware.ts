import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { requestContextStorage } from './request-context';
import type { MetricsService } from './metrics.service';

/**
 * Canonical header name for the per-request correlation id.
 *
 * Re-used by the iPad client and by other services that want to
 * forward the same id when they call back into us. Anything that
 * reads / writes this header MUST import the constant from this
 * module so a future rename changes one site.
 */
export const REQUEST_ID_HEADER = 'X-Request-Id';

/**
 * Catch-all bucket used when the request did not match any
 * NestJS route (i.e. the controller chain returned 404). Without
 * this fallback the metric would explode with one series per
 * random URL — a denial-of-service vector.
 */
const NOT_FOUND_BUCKET = '__not_found__';

/**
 * Options accepted by {@link buildRequestMiddleware}.
 *
 * ``metrics`` is the {@link MetricsService} slice the middleware
 * relies on. Production wiring passes the DI-resolved singleton;
 * tests inject a stub via the same surface. The middleware
 * resolves it once at construction time so call sites stay flat.
 */
export interface RequestMiddlewareOptions {
  metrics: Pick<MetricsService, 'recordHttpRequest'>;
}

/**
 * Build the Express-compatible request middleware for PR-N7.
 *
 * Responsibilities, in the order they happen:
 *
 *   1. Resolve a request id — honour the inbound header verbatim
 *      so a caller can pre-correlate; otherwise generate a UUID v4.
 *   2. Stamp the id on ``req.headers`` and on the response so the
 *      caller can echo / log it.
 *   3. Open an {@link requestContextStorage} scope so every log
 *      line in the request graph carries ``request_id``,
 *      ``route``, ``method``.
 *   4. On ``res.on('finish')``, record the request duration and
 *      status against the http_requests_total counter and the
 *      http_request_duration_seconds histogram. The route path
 *      uses the matched ``req.route?.path`` when available and
 *      falls back to ``__not_found__`` otherwise (cardinality
 *      protection).
 *
 * The middleware is mounted in ``main.ts`` via ``app.use(...)``
 * BEFORE every NestJS route so even pre-handler errors and the
 * 404 fall-through are metered.
 */
export function buildRequestMiddleware(
  options: RequestMiddlewareOptions,
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return async (req, res, next): Promise<void> => {
    const inbound = readHeader(req, REQUEST_ID_HEADER);
    const requestId = inbound && inbound.length > 0 ? inbound : randomUUID().replace(/-/g, '');
    stampHeader(req, REQUEST_ID_HEADER, requestId);
    res.setHeader(REQUEST_ID_HEADER, requestId);

    const envelope = {
      request_id: requestId,
      route: extractRoute(req),
      method: req.method ?? 'UNKNOWN',
    };

    const startedAtNs = process.hrtime.bigint();
    res.on('finish', () => {
      const durationSeconds = Number(process.hrtime.bigint() - startedAtNs) / 1e9;
      const path = extractRoute(req) || NOT_FOUND_BUCKET;
      const status = res.statusCode || 0;
      options.metrics.recordHttpRequest(envelope.method, path, status, durationSeconds);
      // Refresh the route inside the envelope so the recorded
      // label tracks the controller that actually matched. The
      // envelope is also rebound inside the AsyncLocalStorage
      // scope (see below).
      envelope.route = path;
    });

    requestContextStorage.run(envelope, () => {
      next();
    });
  };
}

/**
 * Express stores inbound headers lower-cased (``req.headers``).
 * ``getHeader`` (Node 17+) is preferred but the helper stays
 * version-tolerant for older deployments.
 */
function readHeader(req: Request, name: string): string | undefined {
  const lower = name.toLowerCase();
  const headers = req.headers as Record<string, string | string[] | undefined>;
  const value = headers[lower];
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.length > 0) return value[0];
  return undefined;
}

/**
 * Stamp the request id back onto ``req.headers`` so downstream
 * handlers (and the AsyncLocalStorage snapshot above) read the
 * SAME id without re-deriving it.
 */
function stampHeader(req: Request, name: string, value: string): void {
  const lower = name.toLowerCase();
  const headers = req.headers as Record<string, string | string[] | undefined>;
  headers[lower] = value;
}

/**
 * Express exposes the matched controller route under
 * ``req.route?.path`` (template, e.g. ``/api/books/:book_id``).
 * Returns an empty string when the request did not match any
 * route — callers MUST handle that as ``__not_found__`` for
 * cardinality reasons.
 */
function extractRoute(req: Request): string {
  const routePath = (req as unknown as { route?: { path?: string } }).route?.path;
  if (typeof routePath === 'string' && routePath.length > 0) {
    return routePath;
  }
  return '';
}
