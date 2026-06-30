import { Logger } from '@nestjs/common';
import {
  AdminScanWorker,
  buildAdminScanWorkerOptions,
} from '../../src/workers/admin-scan.worker';
import {
  SCAN_REPOSITORY,
} from '../../src/admin/scan/scan.repository';
import { SCAN_JOB_PRODUCER } from '../../src/admin/scan/scan.service';
import { ScanEventBus } from '../../src/admin/scan/scan-event-bus';
import { ScanProgressEvent, ScanJob } from '../../src/admin/scan/scan.types';

/**
 * Contract tests for {@link AdminScanWorker} (PR-N4).
 *
 * The worker is the consumer-side counterpart of the admin scan
 * surface: it picks up jobs the {@link ScanController} enqueued,
 * walks the library's ``root_path``, and calls
 * {@link ScanRepository.updateProgress} between files. Every tick
 * publishes a {@link ScanProgressEvent} on the
 * {@link ScanEventBus} so the SSE stream lights up.
 *
 * The "spawn" step is isolated behind a {@link ProcessFileFn}
 * seam so the suite does not shell out to Python. The contract
 * pins the orchestration logic:
 *
 *   - A running job transitions to ``done`` once every file has
 *     been processed.
 *   - Every file produces a ``progress`` event with the latest
 *     counter and a final ``done`` event.
 *   - A job with the cooperative ``cancelled`` flag flipped
 *     stops within ONE iteration and transitions to ``cancelled``
 *     without processing further files.
 *   - A failure during processing transitions to ``failed`` and
 *     carries the diagnostic message.
 */

class StubScanRepository {
  rows = new Map<string, ScanJob>();

  async insertJob(job: { id: string; libraryId: number | null; kind: 'full' | 'incremental' }): Promise<ScanJob> {
    const row: ScanJob = {
      id: job.id,
      libraryId: job.libraryId,
      kind: job.kind,
      status: 'queued',
      startedAt: null,
      finishedAt: null,
      totalFiles: null,
      processedFiles: 0,
      cancelled: false,
      error: null,
    };
    this.rows.set(row.id, row);
    return row;
  }

  async getJob(id: string): Promise<ScanJob | null> {
    return this.rows.get(id) ?? null;
  }

  async listJobs(): Promise<ScanJob[]> { return [...this.rows.values()]; }

  async setJobStatus(id: string, status: ScanJob['status']): Promise<ScanJob | null> {
    const row = this.rows.get(id);
    if (!row) return null;
    if (status === 'running' && row.startedAt === null) row.startedAt = new Date();
    if (['done', 'cancelled', 'failed'].includes(status)) row.finishedAt = new Date();
    row.status = status;
    return row;
  }

  async updateProgress(id: string, processedFiles: number, totalFiles: number | null): Promise<ScanJob | null> {
    const row = this.rows.get(id);
    if (!row) return null;
    row.processedFiles = processedFiles;
    if (totalFiles !== null) row.totalFiles = totalFiles;
    return row;
  }

  async setJobError(id: string, error: string): Promise<ScanJob | null> {
    const row = this.rows.get(id);
    if (!row) return null;
    row.error = error;
    return row;
  }

  async requestCancellation(id: string): Promise<void> {
    const row = this.rows.get(id);
    if (row) row.cancelled = true;
  }

  async isCancelled(id: string): Promise<boolean> {
    return this.rows.get(id)?.cancelled === true;
  }

  async close(): Promise<void> {}
}

function buildWorker(opts: {
  files?: string[];
  processFile?: (
    path: string,
  ) => Promise<unknown>;
  repo?: StubScanRepository;
  bus?: ScanEventBus;
} = {}) {
  const repo = opts.repo ?? new StubScanRepository();
  const bus = opts.bus ?? new ScanEventBus();
  const processFile =
    opts.processFile ?? (async () => undefined);
  const discoverFiles = async () => opts.files ?? [];
  // The NestJS DI graph is bypassed in tests; inject the
  // collaborators directly via the protected constructor
  // surface (a manual cast keeps the production wiring
  // untouched).
  const worker = new AdminScanWorker(
    repo as never,
    bus,
    processFile,
    discoverFiles,
  );
  return { worker, repo, bus };
}

describe('AdminScanWorker', () => {
  const originalWarn = Logger.prototype.warn.bind(Logger.prototype);
  beforeAll(() => {
    Logger.prototype.warn = (() => undefined) as never;
  });
  afterAll(() => {
    Logger.prototype.warn = originalWarn;
  });

  it('transitions a queued job to running and walks every file, then done', async () => {
    const files = ['/lib/a.epub', '/lib/b.pdf', '/lib/c.epub'];
    const processed: string[] = [];
    const events: ScanProgressEvent[] = [];
    const repo = new StubScanRepository();
    const bus = new ScanEventBus();
    bus.subscribe('job-1', (e: ScanProgressEvent) => events.push(e));
    await repo.insertJob({ id: 'job-1', libraryId: null, kind: 'full' });
    const { worker } = buildWorker({
      files,
      repo,
      bus,
      processFile: async (p) => {
        processed.push(p);
      },
    });
    await worker.handle({ jobId: 'job-1' });

    const row = await repo.getJob('job-1');
    expect(row!.status).toBe<ScanJob['status']>('done');
    expect(row!.processedFiles).toBe(3);
    expect(row!.totalFiles).toBe(3);
    expect(row!.error).toBeNull();
    expect(processed).toEqual(files);
    // The terminal done event MUST be the last event the bus
    // received (the controller's SSE filter relies on it).
    expect(events.at(-1)?.type).toBe('done');
    expect(events.at(-1)?.processed).toBe(3);
    expect(events.at(-1)?.total).toBe(3);
  });

  it('observes the cooperative cancel flag between files and stops within one iteration', async () => {
    const files = ['/lib/a.epub', '/lib/b.pdf', '/lib/c.epub'];
    const processed: string[] = [];
    const repo = new StubScanRepository();
    const bus = new ScanEventBus();
    await repo.insertJob({ id: 'job-2', libraryId: null, kind: 'full' });
    // Pre-flip the cancel flag so the worker observes it on its
    // very first isCancelled check.
    await repo.requestCancellation('job-2');
    const { worker } = buildWorker({
      files,
      repo,
      bus,
      processFile: async (p) => {
        processed.push(p);
      },
    });
    await worker.handle({ jobId: 'job-2' });
    const row = await repo.getJob('job-2');
    expect(row!.status).toBe<ScanJob['status']>('cancelled');
    // No files should have been processed — the cooperative
    // check fires before the first file.
    expect(processed).toEqual([]);
  });

  it('transitions to failed and records the diagnostic when processFile throws', async () => {
    const files = ['/lib/a.epub', '/lib/b.pdf'];
    const repo = new StubScanRepository();
    const bus = new ScanEventBus();
    await repo.insertJob({ id: 'job-3', libraryId: null, kind: 'full' });
    const { worker } = buildWorker({
      files,
      repo,
      bus,
      processFile: async () => {
        throw new Error('sidecar blew up');
      },
    });
    await worker.handle({ jobId: 'job-3' });
    const row = await repo.getJob('job-3');
    expect(row!.status).toBe<ScanJob['status']>('failed');
    expect(row!.error).toBe('sidecar blew up');
  });

  it('emits a progress event between every file with the running counter', async () => {
    const files = ['/lib/a.epub', '/lib/b.pdf', '/lib/c.epub', '/lib/d.epub'];
    const repo = new StubScanRepository();
    const bus = new ScanEventBus();
    await repo.insertJob({ id: 'job-4', libraryId: null, kind: 'full' });
    const events: ScanProgressEvent[] = [];
    bus.subscribe('job-4', (e: ScanProgressEvent) => events.push(e));
    const { worker } = buildWorker({
      files,
      repo,
      bus,
      processFile: async () => undefined,
    });
    await worker.handle({ jobId: 'job-4' });
    // 4 progress events + 1 done event.
    const progressEvents = events.filter((e) => e.type === 'progress');
    expect(progressEvents).toHaveLength(4);
    expect(progressEvents.map((e) => e.processed)).toEqual([1, 2, 3, 4]);
  });
});

describe('buildAdminScanWorkerOptions', () => {
  it('shares the queue defaults with the producer (attempts/backoff/removeOn*)', () => {
    const opts = buildAdminScanWorkerOptions();
    expect(opts.attempts).toBe(3);
    expect(opts.removeOnComplete).toEqual({ age: 3600, count: 1000 });
    expect(opts.removeOnFail).toEqual({ age: 86400 });
  });
});