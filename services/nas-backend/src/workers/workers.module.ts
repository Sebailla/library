import {
  Inject,
  Injectable,
  Logger,
  Module,
  OnApplicationShutdown,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConnectionOptions, Job, UnrecoverableError, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { DownloadsModule } from '../downloads/downloads.module';
import { BULLMQ_CONNECTION, buildBullMqConnection } from './bullmq.config';
import {
  DOWNLOADS_QUEUE_NAME,
  DownloadResumeJob,
  DownloadsProcessor,
} from './downloads.processor';
import { ScanProcessor, SidecarError } from './scan.processor';

/**
 * Wire-format for jobs enqueued on the ``scan`` queue. The actual
 * processor that consumes them is {@link ScanProcessor}.
 */
export interface ScanJobPayload {
  path: string;
  sha256_hint?: string;
}

/**
 * Shared BullMQ queue options (4R review #35).
 *
 *   - ``attempts: 3`` with exponential 5s backoff lets transient
 *     spawn failures (Redis blip, momentary CPU pressure) recover
 *     before the job is moved to the failed set.
 *   - ``removeOnComplete`` keeps the completed set bounded so a
 *     long-running queue does not grow unbounded; 1h of history is
 *     enough for operators to inspect recent runs.
 *   - ``removeOnFail`` keeps failed jobs for 24h so an operator
 *     has a full day to triage before BullMQ reaps them.
 *
 * The factory returns a plain object so the same options are
 * applied to both the ``scan`` and ``downloads`` workers AND the
 * (future) producer ``Queue.defaultJobOptions`` so callers that
 * call ``queue.add(...)`` without explicit options still pick up
 * the same retry budget.
 *
 * The values are exposed as a free function (not a constant) so
 * tests can assert against the same object the wiring uses
 * without reaching into module internals.
 */
export function buildQueueOptions(): {
  attempts: number;
  backoff: { type: 'exponential'; delay: number };
  removeOnComplete: { age: number; count: number };
  removeOnFail: { age: number };
} {
  return {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { age: 86400 },
  };
}

/**
 * Shape of the inner processor the {@link makeResilientProcessor}
 * wrapper composes. Mirrors BullMQ's ``Processor<DataType,
 * ResultType>`` shape so the wrapped function is drop-in compatible
 * with ``new Worker(name, processor, opts)``.
 */
type InnerProcessor<T> = (job: Job<T, unknown, string>) => Promise<unknown>;

/**
 * Wrap a BullMQ processor so a thrown {@link SidecarError} is
 * translated into an {@link UnrecoverableError} (4R review #35).
 *
 * Rationale: corrupt input (FILE_UNREADABLE, INVALID_PATH, etc.)
 * does not get better with retries — the same file will fail
 * the same way next attempt. Marking the failure ``unrecoverable``
 * lets BullMQ skip the remaining attempts and move the job
 * straight to ``failed``, freeing the queue head for the next
 * job. Transient errors (Redis blip, spawn ENOMEM, etc.) are
 * rethrown as-is so BullMQ's normal retry loop applies.
 */
export function makeResilientProcessor<T>(
  inner: InnerProcessor<T>,
): InnerProcessor<T> {
  return async (job: Job<T, unknown, string>): Promise<unknown> => {
    try {
      return await inner(job);
    } catch (err) {
      if (err instanceof SidecarError) {
        // Preserve the SidecarError code/message on the wrapped
        // error so the failed set keeps the same diagnostic shape;
        // BullMQ's failed job carries ``failedReason`` from the
        // error message, so we keep the original message verbatim.
        throw new UnrecoverableError(err.message);
      }
      throw err;
    }
  };
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
type BullMqConnection = ConnectionOptions;

/**
 * Hook the workers module runs at boot. When a real Redis client
 * is injected, the hook starts the BullMQ workers. When the
 * ``BULLMQ_CONNECTION`` provider is overridden in tests (or
 * Redis is genuinely unreachable in production) the hook
 * logs a single warning and returns — the rest of the app
 * keeps running so ``/api/health`` can still report
 * ``redis: down`` for operators.
 */
@Injectable()
export class WorkersBootstrap implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(WorkersBootstrap.name);
  private readonly workers: Array<{ name: string; worker: Worker }> = [];

  constructor(
    @Optional() @Inject(BULLMQ_CONNECTION) private readonly connection: Redis | null,
    private readonly scanProcessor: ScanProcessor,
    private readonly downloadsProcessor: DownloadsProcessor,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.connection) {
      this.logger.warn(
        'BULLMQ_CONNECTION not provided — workers disabled. ' +
          'Set REDIS_HOST/REDIS_PORT to enable scan and download resume.',
      );
      return;
    }
    // Probe Redis with a short timeout before constructing the
    // BullMQ workers. If the broker is unreachable we skip the
    // boot so the rest of the API can keep serving — the
    // ``/api/health`` endpoint is the source of truth for the
    // operator's view of Redis availability.
    const reachable = await this.pingRedis(750);
    if (!reachable) {
      this.logger.warn(
        'Redis unreachable at boot — workers disabled. ' +
          'The HTTP API keeps running; check /api/health for status.',
      );
      return;
    }
    const conn: BullMqConnection = this.connection as unknown as BullMqConnection;
    try {
      // ``removeOnComplete`` + ``removeOnFail`` are valid
      // ``WorkerOptions`` (BullMQ applies them on the worker
      // side). ``attempts`` + ``backoff`` live on the producer
      // Queue's ``defaultJobOptions`` because that is the only
      // BullMQ surface that honours them; the same factory
      // {@link buildQueueOptions} feeds both so the retry
      // budget is consistent regardless of where a job is
      // added.
      const queueOpts = buildQueueOptions();
      const scan = new Worker<ScanJobPayload, unknown>(
        'scan',
        makeResilientProcessor<ScanJobPayload>(async (job) =>
          this.scanProcessor.handle(job.data),
        ),
        {
          connection: conn,
          removeOnComplete: queueOpts.removeOnComplete,
          removeOnFail: queueOpts.removeOnFail,
        },
      );
      const downloads = new Worker<DownloadResumeJob, unknown>(
        DOWNLOADS_QUEUE_NAME,
        makeResilientProcessor<DownloadResumeJob>(async (job) =>
          this.downloadsProcessor.handle(job.data),
        ),
        {
          connection: conn,
          removeOnComplete: queueOpts.removeOnComplete,
          removeOnFail: queueOpts.removeOnFail,
        },
      );
      this.workers.push({ name: 'scan', worker: scan });
      this.workers.push({ name: DOWNLOADS_QUEUE_NAME, worker: downloads });
      this.logger.log(
        `started 2 BullMQ workers on queue=scan, ${DOWNLOADS_QUEUE_NAME}`,
      );
    } catch (err) {
      this.logger.warn(
        `failed to start BullMQ workers: ${(err as Error).message}`,
      );
    }
  }

  private async pingRedis(timeoutMs: number): Promise<boolean> {
    if (!this.connection) return false;
    try {
      // Force a connection (``lazyConnect: true`` means we have
      // not yet established the socket) and race the ping against
      // a short timeout. The timeout is intentionally tiny so the
      // boot path is not held up when Redis is genuinely down.
      const result = await Promise.race<Promise<unknown>>([
        this.connection.connect().then(() => this.connection!.ping()),
        new Promise((_resolve, reject) =>
          setTimeout(() => reject(new Error('redis ping timeout')), timeoutMs),
        ),
      ]);
      return result === 'PONG';
    } catch (err) {
      this.logger.debug(
        `redis ping failed: ${(err as Error).message}`,
      );
      try {
        this.connection.disconnect();
      } catch {
        /* ignore — best-effort cleanup */
      }
      return false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all(
      this.workers.map(async ({ name, worker }) => {
        try {
          await worker.close();
        } catch (err) {
          this.logger.warn(
            `error closing worker ${name}: ${(err as Error).message}`,
          );
        }
      }),
    );
  }
}

/**
 * Workers module — BullMQ + Python sidecar spawn (PR-2E, work
 * unit 2).
 *
 * Owns:
 *
 *   - The {@link ScanProcessor} that shells out to the
 *     ``alejandria-sidecar`` CLI for every new file the NAS
 *     filesystem watcher enqueues.
 *   - The {@link DownloadsProcessor} that updates
 *     ``bytes_transferred`` for in-progress downloads (resume
 *     bookkeeping, off the Range-request thread).
 *   - A shared ``ioredis`` connection built by
 *     {@link buildBullMqConnection} and bound to the
 *     ``BULLMQ_CONNECTION`` string token so e2e tests can
 *     override it with a stub.
 *
 * The module re-uses ``DownloadsModule`` so the
 * ``DOWNLOADS_REPOSITORY`` token is shared between the HTTP
 * layer (PR-2E work unit 1) and the worker. The bootstrap
 * swallows Redis errors at boot — see
 * {@link WorkersBootstrap} — so the rest of the app keeps
 * serving traffic even when the broker is down.
 */
@Module({
  imports: [DownloadsModule],
  providers: [
    ScanProcessor,
    DownloadsProcessor,
    WorkersBootstrap,
    {
      provide: BULLMQ_CONNECTION,
      useFactory: (): Redis => buildBullMqConnection(),
    },
  ],
  exports: [ScanProcessor, DownloadsProcessor, BULLMQ_CONNECTION],
})
export class WorkersModule {}
