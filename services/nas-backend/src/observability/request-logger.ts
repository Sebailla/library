import { pino, Logger as PinoLogger, LoggerOptions } from 'pino';
import { RequestContext } from './request-context';

/**
 * Stream factory contract for tests. The production wiring passes
 * no ``stream`` and lets pino write to stdout (the default in
 * containerised deploys). Tests inject a recording stream so the
 * suite can assert on the structured log lines.
 */
export type LogStream = Parameters<typeof pino>[1];

/**
 * Build a Pino logger that auto-stamps the active {@link
 * RequestContext} envelope on every log line emitted inside a
 * request.
 *
 * Pino's ``mixin`` callback runs on every log call, so reading
 * ``RequestContext.get()`` there is the cheapest way to attach the
 * per-request envelope without ceremony at every call site.
 *
 * The mixin is intentionally lightweight:
 *
 *   - It reads the env once per log call (a single async-hook
 *     read; no I/O).
 *   - It only emits the envelope keys when an envelope is set
 *     (bootstrap logs stay clean).
 *
 * Options:
 *
 *   - ``options.level`` overrides the global default. The NestJS
 *     bootstrap reads ``LOG_LEVEL`` and forwards it here so the
 *     same env var flips every log sink in one place.
 *   - ``stream`` is the optional destination. Tests inject a
 *     recorder; production never sets one (stdout).
 */
export function buildRequestLogger(
  options: LoggerOptions = {},
  stream?: LogStream,
): PinoLogger {
  const mixin = (): Record<string, string> => {
    const ctx = RequestContext.get();
    if (!ctx) return {};
    return {
      request_id: ctx.request_id,
      route: ctx.route,
      method: ctx.method,
    };
  };
  return stream ? pino({ ...options, mixin }, stream) : pino({ ...options, mixin });
}

/**
 * Production singleton. Built once at module load with the env-
 * driven level and the default stdout destination.
 *
 * ``requestLogger.info(...)`` / ``.warn`` / ``.error`` /
 * ``.debug`` are drop-in replacements for NestJS' built-in
 * ``Logger``; anywhere in the codebase that wants structured
 * JSON logs imports this singleton.
 */
export const requestLogger: PinoLogger = buildRequestLogger({
  level: process.env.LOG_LEVEL ?? 'info',
});
