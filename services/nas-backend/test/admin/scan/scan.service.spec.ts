import {
  ScanJob,
  ScanJobKind,
  ScanJobStatus,
} from '../../../src/admin/scan/scan.types';
import {
  ScanRepository,
} from '../../../src/admin/scan/scan.repository';
import {
  ScanService,
  EnqueueScanInput,
} from '../../../src/admin/scan/scan.service';
import { ScanEventBus } from '../../../src/admin/scan/scan-event-bus';

/**
 * Contract tests for {@link ScanService} (PR-N4).
 *
 * The service is the orchestration layer between the HTTP
 * controller, the BullMQ producer (the workers module's
 * ``scan`` queue), and the cooperative cancellation worker.
 *
 * Scenarios covered:
 *
 *   - ``enqueueScan`` records a queued row, asks the BullMQ
 *     producer to enqueue a job carrying the same UUID, and
 *     returns the row the caller should mirror back to the
 *     iPad client.
 *   - ``enqueueScan`` accepts both ``full`` and ``incremental``
 *     kinds.
 *   - ``cancelScan`` flips the cooperative cancel flag via the
 *     repository, but only for jobs that exist; a missing id
 *     resolves to ``false`` (no exception leak).
 *   - ``cancelScan`` does NOT touch a job that is already in a
 *     terminal state — re-cancelling a ``done`` job would race
 *     with the worker's bookkeeping.
 *   - ``listJobs`` / ``getJob`` proxy to the repository.
 */

class StubScanRepository {
  private rows = new Map<string, ScanJob>();

  async insertJob(job: { id: string; libraryId: number | null; kind: ScanJobKind }): Promise<ScanJob> {
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

  async listJobs(): Promise<ScanJob[]> {
    return [...this.rows.values()];
  }

  async setJobStatus(id: string, status: ScanJobStatus): Promise<ScanJob | null> {
    const row = this.rows.get(id);
    if (!row) return null;
    if (status === 'running' && row.startedAt === null) row.startedAt = new Date();
    if (['done', 'cancelled', 'failed'].includes(status)) row.finishedAt = new Date();
    row.status = status;
    return row;
  }

  async requestCancellation(id: string): Promise<void> {
    const row = this.rows.get(id);
    if (!row) return;
    row.cancelled = true;
  }

  async isCancelled(id: string): Promise<boolean> {
    return this.rows.get(id)?.cancelled === true;
  }

  async close(): Promise<void> {}
}

interface EnqueuedJob {
  name: string;
  data: { jobId: string };
}

class StubProducer {
  public jobs: EnqueuedJob[] = [];
  async add(name: string, data: { jobId: string }): Promise<void> {
    this.jobs.push({ name, data });
  }
  async close(): Promise<void> {}
}

function buildService() {
  const repo = new StubScanRepository() as unknown as ScanRepository;
  const producer = new StubProducer();
  const bus = new ScanEventBus();
  const service = new ScanService(
    repo,
    bus,
    {
      add: (data: { jobId: string }) => producer.add('scan', data),
    } as never,
  );
  return { service, repo, producer, bus };
}

describe('ScanService', () => {
  it('enqueueScan persists a queued row and asks the BullMQ producer to enqueue it', async () => {
    const { service, repo, producer } = buildService();
    const input: EnqueueScanInput = {
      id: '11111111-1111-1111-1111-111111111111',
      libraryId: 7,
      kind: 'full',
    };
    const job = await service.enqueueScan(input);
    expect(job.id).toBe(input.id);
    expect(job.kind).toBe('full');
    expect(job.status).toBe<ScanJobStatus>('queued');
    // BullMQ producer MUST have been called with the same UUID so
    // the worker can resolve the row without a second hop.
    expect(producer.jobs).toEqual([
      { name: 'scan', data: { jobId: input.id } },
    ]);
    // Repository MUST hold the row so the status endpoint can
    // resolve it before the worker picks it up.
    const stored = await (repo as unknown as StubScanRepository).getJob(input.id);
    expect(stored).not.toBeNull();
    expect(stored!.status).toBe<ScanJobStatus>('queued');
  });

  it('enqueueScan accepts both full and incremental kinds', async () => {
    const { service } = buildService();
    const full = await service.enqueueScan({
      id: '22222222-2222-2222-2222-222222222222',
      libraryId: 1,
      kind: 'full',
    });
    expect(full.kind).toBe<ScanJobKind>('full');
    const incremental = await service.enqueueScan({
      id: '33333333-3333-3333-3333-333333333333',
      libraryId: 1,
      kind: 'incremental',
    });
    expect(incremental.kind).toBe<ScanJobKind>('incremental');
  });

  it('cancelScan flips the cooperative flag for an existing running job', async () => {
    const { service, repo } = buildService();
    const job = await service.enqueueScan({
      id: '44444444-4444-4444-4444-444444444444',
      libraryId: 1,
      kind: 'full',
    });
    await repo.setJobStatus(job.id, 'running');
    const cancelled = await service.cancelScan(job.id);
    expect(cancelled).toBe(true);
    expect(await repo.isCancelled(job.id)).toBe(true);
  });

  it('cancelScan resolves to false for an unknown job (no exception leak)', async () => {
    const { service } = buildService();
    const cancelled = await service.cancelScan(
      '99999999-9999-9999-9999-999999999999',
    );
    expect(cancelled).toBe(false);
  });

  it('cancelScan does NOT touch a job that is already in a terminal state', async () => {
    const { service, repo } = buildService();
    const job = await service.enqueueScan({
      id: '55555555-5555-5555-5555-555555555555',
      libraryId: 1,
      kind: 'full',
    });
    await repo.setJobStatus(job.id, 'running');
    await repo.setJobStatus(job.id, 'done');
    const cancelled = await service.cancelScan(job.id);
    // Already-done job stays untouched — flipping the cancel flag
    // after the worker has finished would race with the worker's
    // own bookkeeping.
    expect(cancelled).toBe(false);
    expect(await repo.isCancelled(job.id)).toBe(false);
  });

  it('listJobs and getJob proxy to the repository', async () => {
    const { service } = buildService();
    const a = await service.enqueueScan({
      id: '66666666-6666-6666-6666-666666666666',
      libraryId: 1,
      kind: 'full',
    });
    const b = await service.enqueueScan({
      id: '77777777-7777-7777-7777-777777777777',
      libraryId: 2,
      kind: 'incremental',
    });
    const list = await service.listJobs();
    expect(list.map((j) => j.id).sort()).toEqual([a.id, b.id].sort());
    const single = await service.getJob(a.id);
    expect(single?.id).toBe(a.id);
  });
});