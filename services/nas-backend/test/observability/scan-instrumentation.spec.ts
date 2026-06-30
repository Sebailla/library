import type { MetricsService } from '../../src/observability/metrics.service';
import {
  InstrumentedAdminScanWorker,
  instrumentAdminScanWorker,
} from '../../src/observability/scan-instrumentation';

/**
 * Contract tests for the scan-worker instrumentation adapter
 * (PR-N7, issue #92).
 *
 * The adapter wraps ``AdminScanWorker.handle`` so each terminal
 * job transition bumps the matching counter / histogram.
 *
 * Cardinality budget pinned:
 *
 *   - ``scan_jobs_total{status="done"}``  — the worker returned
 *     without throwing (it may have cancelled mid-flight, but
 *     the worker's contract doesn't expose that distinction
 *     here — we let the service layer instrument cancellations
 *     separately if needed).
 *   - ``scan_jobs_total{status="failed"}``  — ``handle`` threw
 *     (the processFile failure path).
 *   - ``scan_job_duration_seconds`` — observed once per
 *     ``handle`` invocation, even on the failure path, so the
 *     histogram count tracks job completions.
 */
describe('InstrumentedAdminScanWorker (PR-N7)', () => {
  interface Payload {
    jobId: string;
  }

  /**
   * Minimal AdminScanWorker double. The adapter only calls
   * ``handle`` and surfaces thrown errors, so a stub is enough.
   */
  class StubWorker {
    calls: Payload[] = [];
    async handle(payload: Payload): Promise<void> {
      this.calls.push(payload);
    }
  }

  it('records scan_jobs_total{status="done"} when the worker completes', async () => {
    const recordScanJob = jest.fn();
    const recordScanJobDuration = jest.fn();
    const inner = new StubWorker();
    const inst: InstrumentedAdminScanWorker = instrumentAdminScanWorker(
      inner as never,
      { recordScanJob, recordScanJobDuration } as Pick<
        MetricsService,
        'recordScanJob' | 'recordScanJobDuration'
      >,
    );
    await inst.handle({ jobId: 'j1' });
    expect(recordScanJob).toHaveBeenCalledWith('done');
    expect(recordScanJobDuration).toHaveBeenCalledTimes(1);
  });

  it('records scan_jobs_total{status="failed"} when the worker throws', async () => {
    const recordScanJob = jest.fn();
    const recordScanJobDuration = jest.fn();
    const inner = {
      handle: async () => {
        throw new Error('spawn blew up');
      },
    } as never;
    const inst = instrumentAdminScanWorker(inner, {
      recordScanJob,
      recordScanJobDuration,
    } as Pick<MetricsService, 'recordScanJob' | 'recordScanJobDuration'>);
    await expect(inst.handle({ jobId: 'j2' })).rejects.toThrow('spawn blew up');
    expect(recordScanJob).toHaveBeenCalledWith('failed');
  });

  it('records the duration even when the worker throws (failure must still be observable in histograms)', async () => {
    const recordScanJob = jest.fn();
    const recordScanJobDuration = jest.fn();
    const inner = {
      handle: async () => {
        throw new Error('sidecar spawn failed');
      },
    } as never;
    const inst = instrumentAdminScanWorker(inner, {
      recordScanJob,
      recordScanJobDuration,
    } as Pick<MetricsService, 'recordScanJob' | 'recordScanJobDuration'>);
    await expect(inst.handle({ jobId: 'j4' })).rejects.toThrow();
    expect(recordScanJobDuration).toHaveBeenCalledTimes(1);
    const duration = recordScanJobDuration.mock.calls[0]![0];
    expect(typeof duration).toBe('number');
    expect(duration).toBeGreaterThanOrEqual(0);
  });

  it('delegates the payload to the inner worker unchanged', async () => {
    const recordScanJob = jest.fn();
    const recordScanJobDuration = jest.fn();
    const inner = new StubWorker();
    const inst = instrumentAdminScanWorker(inner as never, {
      recordScanJob,
      recordScanJobDuration,
    } as Pick<MetricsService, 'recordScanJob' | 'recordScanJobDuration'>);
    await inst.handle({ jobId: 'payload-uuid' });
    expect(inner.calls).toEqual([{ jobId: 'payload-uuid' }]);
  });
});

void (null as unknown as MetricsService);
