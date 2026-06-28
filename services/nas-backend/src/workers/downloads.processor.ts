import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConnectionOptions, Job, JobsOptions, Queue, Worker } from 'bullmq';
import {
  DOWNLOADS_REPOSITORY,
  DownloadsRepository,
} from '../downloads/downloads.repository';

/** BullMQ queue name for download-resume jobs. */
export const DOWNLOADS_QUEUE_NAME = 'downloads';

/** Job payload consumed by ``DownloadsProcessor``. */
export interface DownloadResumeJob {
  downloadId: number;
  bytesTransferred: number;
}

/**
 * BullMQ's bundled ioredis type and the one we depend on at the
 * app level are two distinct copies of the same library; passing
 * the ``Redis`` instance across the boundary makes TypeScript
 * complain about structurally identical but nominally different
 * types. The production wiring is the same (a single ``ioredis``
 * instance from {@link buildBullMqConnection}); the cast is
 * necessary because BullMQ's d.ts pin to its own copy.
 */
export type BullMqConnection = ConnectionOptions;

/** Stable error codes raised by {@link DownloadsProcessor}. */
export type DownloadResumeErrorCode = 'DOWNLOAD_NOT_FOUND' | 'DOWNLOAD_RESUME_FAILED';

/**
 * Downloads resume processor — BullMQ handler that the HTTP layer
 * enqueues to update ``bytes_transferred`` without blocking the
 * Range-request streaming thread.
 *
 * The processor accepts a ``DOWNLOADS_REPOSITORY`` (string token
 * from the downloads module) so e2e tests can swap in a stub
 * without touching the real DB. The Redis client is built via
 * {@link buildBullMqConnection} and may be overridden in tests
 * through the ``BULLMQ_CONNECTION`` string token.
 */
@Injectable()
export class DownloadsProcessor {
  private readonly logger = new Logger(DownloadsProcessor.name);

  constructor(
    @Inject(DOWNLOADS_REPOSITORY)
    private readonly downloads: DownloadsRepository,
  ) {}

  /**
   * Pure handler — no I/O concerns. Given a job payload, update
   * the corresponding download row. Throws
   * ``NotFoundException`` when the row is missing so the BullMQ
   * worker surfaces a clean failure (the surrounding
   * {@link makeDownloadsWorker} decides whether to retry).
   */
  async handle(
    job: DownloadResumeJob,
  ): Promise<{ downloadId: number; bytesTransferred: number }> {
    const existing = await this.downloads.findById(job.downloadId);
    if (!existing) {
      throw new NotFoundException({
        error: {
          code: 'DOWNLOAD_NOT_FOUND',
          message: `Download ${job.downloadId} not found`,
        },
      });
    }
    await this.downloads.updateProgress(job.downloadId, job.bytesTransferred);
    this.logger.log(
      `downloads#${job.downloadId} progress=${job.bytesTransferred}`,
    );
    return { downloadId: job.downloadId, bytesTransferred: job.bytesTransferred };
  }
}

/**
 * Build the BullMQ ``Worker`` that wraps {@link DownloadsProcessor}.
 *
 * Exposed as a free function (not a class method) so the workers
 * module can compose it from injectable providers without the
 * worker itself becoming a NestJS class. ``connection`` is
 * required — callers (e.g. the workers module bootstrap) MUST
 * have already verified Redis availability before calling this
 * factory.
 */
export function makeDownloadsWorker(
  processor: DownloadsProcessor,
  connection: BullMqConnection,
  queueName: string = DOWNLOADS_QUEUE_NAME,
): Worker<DownloadResumeJob, { downloadId: number; bytesTransferred: number }> {
  return new Worker<DownloadResumeJob, { downloadId: number; bytesTransferred: number }>(
    queueName,
    async (job: Job<DownloadResumeJob>) => processor.handle(job.data),
    { connection },
  );
}

/**
 * Build a producer queue so the HTTP layer (or another worker)
 * can ``enqueueResume`` without a circular dependency on the
 * worker itself.
 */
export function makeDownloadsQueue(
  connection: BullMqConnection,
  options: { queueName?: string; defaultJobOptions?: JobsOptions } = {},
): Queue<DownloadResumeJob> {
  return new Queue<DownloadResumeJob>(options.queueName ?? DOWNLOADS_QUEUE_NAME, {
    connection,
    defaultJobOptions: options.defaultJobOptions,
  });
}
