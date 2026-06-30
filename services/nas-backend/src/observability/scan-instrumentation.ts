import type { AdminScanWorker, AdminScanJobPayload } from '../workers/admin-scan.worker';
import type { MetricsService } from './metrics.service';

/**
 * Surface implemented by {@link instrumentAdminScanWorker}.
 *
 * The adapter mirrors the worker's public ``handle`` API so
 * the BullMQ consumer wiring (see ``workers.module.ts``) can
 * swap the wrapped worker in without changing the bridge
 * contract.
 */
export interface InstrumentedAdminScanWorker {
  handle(payload: AdminScanJobPayload): Promise<void>;
}

/**
 * Wrap an {@link AdminScanWorker} so each terminal job
 * transition emits the matching Prometheus counter / histogram.
 *
 * What is recorded:
 *
 *   - ``scan_jobs_total{status="done"}``  when ``handle`` resolves.
 *   - ``scan_jobs_total{status="failed"}`` when ``handle`` throws.
 *   - ``scan_job_duration_seconds`` once per ``handle``
 *     invocation, regardless of outcome, so the histogram
 *     count tracks every job the worker processed.
 *
 * Cancellation is NOT distinguished from success at this
 * layer: the worker reports cancellation by transitioning the
 * row to ``cancelled`` and returning normally. Recording that
 * here would require reading the repository, which couples
 * the adapter to the persistence layer. The admin scan
 * controller or service can extend the contract later by
 * exposing a ``lastTerminalStatus`` accessor — keeping this
 * PR-N7 minimal keeps the change isolated.
 */
export function instrumentAdminScanWorker(
  inner: Pick<AdminScanWorker, 'handle'>,
  metrics: Pick<MetricsService, 'recordScanJob' | 'recordScanJobDuration'>,
): InstrumentedAdminScanWorker {
  return {
    async handle(payload) {
      const startedAt = process.hrtime.bigint();
      try {
        await inner.handle(payload);
        const elapsed = Number(process.hrtime.bigint() - startedAt) / 1e9;
        metrics.recordScanJobDuration(elapsed);
        metrics.recordScanJob('done');
      } catch (err) {
        const elapsed = Number(process.hrtime.bigint() - startedAt) / 1e9;
        metrics.recordScanJobDuration(elapsed);
        metrics.recordScanJob('failed');
        throw err;
      }
    },
  };
}
