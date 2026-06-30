import { Inject, Injectable, Logger } from '@nestjs/common';
import { SCAN_REPOSITORY, ScanRepository } from '../admin/scan/scan.repository';
import { ScanProgressEvent } from '../admin/scan/scan.types';
import { ScanEventBus } from '../admin/scan/scan-event-bus';

/**
 * Payload the admin scan producer enqueues. The worker re-reads
 * the row from ``scan_jobs`` to get ``library_id`` and ``kind``;
 * the UUID is the only thing the producer knows.
 */
export interface AdminScanJobPayload {
  jobId: string;
}

/**
 * Function used by {@link AdminScanWorker} to process one file
 * (spawn the sidecar, persist the envelope, etc.). The default
 * implementation is a no-op so the test suite does not shell
 * out to Python; production wiring injects a function that
 * bridges to ``ScanProcessor.handle`` plus the books upsert.
 */
export type ProcessFileFn = (path: string) => Promise<unknown>;

/**
 * Function used by {@link AdminScanWorker} to discover the list
 * of files to process for a given job. Production wiring walks
 * ``library.root_path`` recursively; tests inject a static
 * fixture.
 */
export type DiscoverFilesFn = (jobId: string) => Promise<string[]>;

// NOTE: prior versions of this file re-exported
// ``buildAdminScanWorkerOptions()`` — a thin pass-through over
// ``buildQueueOptions()`` that was consumed only by the test
// suite. Workers module reads retry values straight from
// ``buildQueueOptions()`` (see ``workers.module.ts``), so the
// wrapper duplicated the retry knobs without value. Removed in
// issue #98.

/**
 * Admin scan worker — PR-N4.
 *
 * The worker is the consumer-side counterpart of the admin scan
 * surface: it picks up jobs the {@link ScanController} enqueued,
 * walks the library's ``root_path`` (via the injected
 * ``discoverFiles`` closure), and calls
 * {@link ScanRepository.updateProgress} between files. Every
 * tick publishes a {@link ScanProgressEvent} on the
 * {@link ScanEventBus} so the SSE stream lights up.
 *
 * Cooperative cancellation: the worker checks the
 * ``cancelled`` flag BEFORE the first file and BEFORE every
 * subsequent file. The repository's ``isCancelled`` returns
 * ``false`` for unknown ids so a late publish on a not-yet-
 * persisted row does not bail out.
 *
 * Failure routing: a thrown error from ``processFile`` is
 * caught, written to the row's ``error`` column, and the job
 * is transitioned to ``failed``. BullMQ sees the resolved
 * promise and removes the job from the active set — the row
 * is the audit trail, not the failed BullMQ set.
 */
@Injectable()
export class AdminScanWorker {
  private readonly logger = new Logger(AdminScanWorker.name);

  constructor(
    @Inject(SCAN_REPOSITORY)
    private readonly repo: ScanRepository,
    private readonly bus: ScanEventBus,
    private readonly processFile: ProcessFileFn = async () => undefined,
    private readonly discoverFiles: DiscoverFilesFn = async () => [],
  ) {}

  /**
   * Process one BullMQ job. The payload is just the UUID — the
   * row's ``library_id`` and ``kind`` are read from the
   * ``scan_jobs`` table inside this method.
   */
  async handle(payload: AdminScanJobPayload): Promise<void> {
    const { jobId } = payload;
    const job = await this.repo.getJob(jobId);
    if (!job) {
      // Drop silently: the row may have been pruned between
      // enqueue and pickup (the operator cancelled the DB row
      // directly). The BullMQ job resolves so it does not loop.
      this.logger.warn(`admin scan job ${jobId} not found — dropping`);
      return;
    }

    // Cooperative cancel check BEFORE we burn any CPU. The
    // controller sets the flag via ``POST /api/admin/scan/
    // cancel/:job_id``; a worker that observes the flag here
    // transitions straight to ``cancelled`` without touching
    // any file.
    if (await this.repo.isCancelled(jobId)) {
      await this.repo.setJobStatus(jobId, 'cancelled');
      this.publishEvent(jobId, 'cancelled', job.processedFiles, job.totalFiles);
      return;
    }

    await this.repo.setJobStatus(jobId, 'running');
    const files = await this.discoverFiles(jobId);
    const total = files.length;
    let processed = 0;

    for (const file of files) {
      // Cooperative cancel check BETWEEN files. The flag is
      // flipped by the controller while the worker is mid-loop;
      // the next iteration picks it up and exits gracefully.
      if (await this.repo.isCancelled(jobId)) {
        await this.repo.setJobStatus(jobId, 'cancelled');
        this.publishEvent(jobId, 'cancelled', processed, total);
        return;
      }
      try {
        await this.processFile(file);
      } catch (err) {
        const message = (err as Error).message ?? String(err);
        // Persist the diagnostic alongside the failed status.
        // The repository's ``setJobStatus`` stamps
        // ``finished_at``; the diagnostic lives on the row, not
        // on the BullMQ failed-job set.
        await this.repo.setJobStatus(jobId, 'failed');
        await this.repo.updateProgress(jobId, processed, total);
        await this.repo.setJobError(jobId, message);
        this.publishEvent(jobId, 'failed', processed, total, message);
        return;
      }
      processed += 1;
      await this.repo.updateProgress(jobId, processed, total);
      this.publishEvent(jobId, 'progress', processed, total);
    }

    await this.repo.setJobStatus(jobId, 'done');
    this.publishEvent(jobId, 'done', processed, total);
  }

  private publishEvent(
    jobId: string,
    type: ScanProgressEvent['type'],
    processed: number,
    total: number | null,
    error?: string,
  ): void {
    const event: ScanProgressEvent = {
      jobId,
      type,
      processed,
      total,
      timestamp: new Date().toISOString(),
    };
    if (error !== undefined) {
      event.error = error;
    }
    this.bus.publish(jobId, event);
  }
}