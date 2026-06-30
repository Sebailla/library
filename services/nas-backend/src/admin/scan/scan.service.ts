import { Inject, Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { ScanRepository } from './scan.repository';
import { ScanJob, ScanJobKind } from './scan.types';
import { ScanEventBus } from './scan-event-bus';

/**
 * Name of the BullMQ queue that carries admin scan jobs. The
 * worker side (``workers.module.ts``) reads from the same
 * constant so a typo cannot desync the producer and the
 * consumer.
 */
export const SCAN_QUEUE_NAME = 'scan';

/**
 * Minimal producer surface the service depends on. The full
 * ``Queue`` class is wider than we need; the interface below is
 * the focused seam the tests use so the e2e tests can substitute
 * an in-memory stub.
 */
export interface ScanJobProducer {
  add(data: ScanJobProducerPayload): Promise<unknown>;
  close(): Promise<void>;
}

/** Payload pushed onto the BullMQ queue for each scan job. */
export interface ScanJobProducerPayload {
  jobId: string;
}

/**
 * Concrete producer that wraps a BullMQ ``Queue``. Constructed
 * via {@link createScanJobProducer} so tests can inject a stub.
 */
export class BullMqScanJobProducer implements ScanJobProducer {
  constructor(private readonly queue: Queue<ScanJobProducerPayload>) {}

  async add(data: ScanJobProducerPayload): Promise<unknown> {
    return this.queue.add(SCAN_QUEUE_NAME, data);
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}

export interface EnqueueScanInput {
  id: string;
  libraryId: number | null;
  kind: ScanJobKind;
}

/**
 * Scan orchestration service — PR-N4.
 *
 * The service is the boundary between the HTTP controller and
 * the two durable surfaces (the ``scan_jobs`` table and the
 * BullMQ queue). It:
 *
 *   - Persists a queued row via the repository.
 *   - Pushes a job onto the BullMQ queue so the worker can pick
 *     it up. The job's only payload is the UUID; the worker
 *     resolves the row from the database.
 *   - Flips the cooperative cancel flag on
 *     ``POST /api/admin/scan/cancel/:id`` — but ONLY for jobs
 *     that are not already terminal. Re-cancelling a done / failed
 *     / cancelled job would race with the worker's bookkeeping.
 *
 * The {@link ScanEventBus} is held so the worker (wired by
 * ``workers.module.ts``) can publish progress events without
 * having to thread an emitter through the constructor.
 */
@Injectable()
export class ScanService {
  private readonly logger = new Logger(ScanService.name);

  constructor(
    @Inject('SCAN_REPOSITORY')
    private readonly repo: ScanRepository,
    private readonly bus: ScanEventBus,
    private readonly producer: ScanJobProducer,
  ) {}

  /**
   * Insert a queued row and enqueue the matching BullMQ job.
   * The job payload carries the UUID only — the worker re-reads
   * the row from ``scan_jobs`` to get ``library_id`` and ``kind``.
   */
  async enqueueScan(input: EnqueueScanInput): Promise<ScanJob> {
    const job = await this.repo.insertJob({
      id: input.id,
      libraryId: input.libraryId,
      kind: input.kind,
    });
    await this.producer.add({ jobId: job.id });
    this.logger.log(
      `enqueued ${input.kind} scan ${job.id} (library=${input.libraryId ?? 'all'})`,
    );
    return job;
  }

  /**
   * Flip the cooperative cancel flag. Returns ``true`` when the
   * flag was actually set, ``false`` for unknown ids or jobs
   * already in a terminal state. The worker observes the flag
   * between two files and transitions to ``cancelled`` itself.
   */
  async cancelScan(id: string): Promise<boolean> {
    const job = await this.repo.getJob(id);
    if (!job) return false;
    if (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') {
      return false;
    }
    await this.repo.requestCancellation(id);
    this.logger.log(`cancellation requested for scan ${id}`);
    return true;
  }

  async listJobs(): Promise<ScanJob[]> {
    return this.repo.listJobs();
  }

  async getJob(id: string): Promise<ScanJob | null> {
    return this.repo.getJob(id);
  }

  /** Read-side handle to the bus. The worker uses this for SSE. */
  getEventBus(): ScanEventBus {
    return this.bus;
  }
}