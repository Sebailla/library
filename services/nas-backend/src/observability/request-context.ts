import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request envelope propagated across the async call graph.
 *
 * Anything that wants a per-request log line (controllers,
 * services, workers triggered from the request, error filters)
 * reads {@link RequestContext.get} and binds ``request_id``,
 * ``route``, and ``method`` to its log lines. The middleware
 * mounted in ``main.ts`` (see
 * ``observability/metrics.middleware.ts``) seeds the store and
 * keeps it alive for the duration of the request.
 */
export interface RequestContextEnvelope {
  /**
   * Stable id correlating every log line emitted during a single
   * request. Either the inbound ``X-Request-Id`` header (when the
   * caller supplied one) or a freshly generated UUID v4.
   */
  request_id: string;
  /**
   * Express route template (e.g. ``/api/books/:book_id``) so the
   * log shape stays consistent whether or not NestJS has finished
   * matching the route yet.
   */
  route: string;
  /** HTTP method. */
  method: string;
}

/**
 * The single {@link AsyncLocalStorage} instance for the backend.
 *
 * Exported as a singleton so every module imports the SAME store
 * — a per-module instance would silently drop the context at
 * module boundaries and the logger would stop emitting
 * ``request_id`` after the first await.
 */
export const requestContextStorage = new AsyncLocalStorage<RequestContextEnvelope>();

/**
 * Helpers around the storage.
 *
 * Always-on: every read goes through these helpers so the call
 * sites stay flat (no ``?.`` everywhere) and so a future bug fix
 * only touches this file.
 */
export const RequestContext = {
  /** Read the active envelope, or ``undefined`` when none is set. */
  get(): RequestContextEnvelope | undefined {
    return requestContextStorage.getStore();
  },
  /**
   * Convenience: return the active ``request_id`` or ``undefined``.
   * Useful for the logger fallback when the request envelope is
   * missing (e.g. during NestJS bootstrap before any HTTP request).
   */
  requestId(): string | undefined {
    return this.get()?.request_id;
  },
};
