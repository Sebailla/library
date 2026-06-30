import {
  Inject,
  Injectable,
  Logger,
  Module,
  OnApplicationShutdown,
  OnModuleInit,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { ConnectionOptions, Job, UnrecoverableError, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import { DownloadsModule } from '../downloads/downloads.module';
import { LibrariesModule } from '../libraries/libraries.module';
import { ScanModule } from '../admin/scan/scan.module';
import { SCAN_QUEUE_NAME } from '../admin/scan/scan.service';
import { SCAN_REPOSITORY, ScanRepository } from '../admin/scan/scan.repository';
import { ScanEventBus } from '../admin/scan/scan-event-bus';
import {
  LIBRARIES_REPOSITORY,
  LibrariesRepository,
} from '../libraries/libraries.repository';
import {
  BULLMQ_CONNECTION,
  buildBullMqConnection,
  buildQueueOptions,
} from './bullmq.config';
// Re-exported for back-compat: callers (the test suite and
// external consumers) historically imported ``buildQueueOptions``
// and ``getScanProducerDefaultJobOptions`` from this module.
// After issue #98 the canonical home is ``bullmq.config.ts``
// (no module deps, breaks the ScanModule ↔ WorkersModule cycle
// on the producer side); the re-export below keeps the old
// import sites working unchanged.
export {
  buildQueueOptions,
  getScanProducerDefaultJobOptions,
} from './bullmq.config';
import {
  DOWNLOADS_QUEUE_NAME,
  DownloadResumeJob,
  DownloadsProcessor,
} from './downloads.processor';
import { ScanProcessor, SidecarError } from './scan.processor';
import {
  AdminScanWorker,
  AdminScanJobPayload,
} from './admin-scan.worker';
import { instrumentAdminScanWorker } from '../observability/scan-instrumentation';
import { METRICS_SERVICE, MetricsService } from '../observability/metrics.service';
import { ObservabilityModule } from '../observability/observability.module';

/**
 * Recursive walk used by the admin scan worker to enumerate
 * the files inside a library's ``root_path``. Best-effort:
 * unreadable directories yield ``[]`` rather than throwing so
 * a corrupt library never halts the queue head.
 */
async function walkLibrary(rootPath: string): Promise<string[]> {
  const out: string[] = [];
  async function visit(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(full);
      } else if (entry.isFile()) {
        out.push(full);
      } else {
        // Symlink / socket / etc — peek, treat symlink-to-file
        // as a file (the sidecar spawn contract rejects the
        // rest).
        try {
          const s = await stat(full);
          if (s.isFile()) out.push(full);
        } catch {
          /* skip */
        }
      }
    }
  }
  await visit(rootPath);
  return out;
}

/**
 * Wire-format for jobs enqueued on the ``scan`` queue. The actual
 * processor that consumes them is {@link ScanProcessor}.
 */
export interface ScanJobPayload {
  path: string;
  sha256_hint?: string;
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
    @Inject(SCAN_REPOSITORY)
    private readonly scanRepo: ScanRepository,
    private readonly scanBus: ScanEventBus,
    @Inject(LIBRARIES_REPOSITORY)
    private readonly libraries: LibrariesRepository,
    @Inject(METRICS_SERVICE)
    private readonly metrics: MetricsService,
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
      const adminScan = new Worker<AdminScanJobPayload, unknown>(
        SCAN_QUEUE_NAME,
        makeResilientProcessor<AdminScanJobPayload>(async (job) =>
          this.runAdminScan(job.data),
        ),
        {
          connection: conn,
          removeOnComplete: queueOpts.removeOnComplete,
          removeOnFail: queueOpts.removeOnFail,
        },
      );
      this.workers.push({ name: 'scan', worker: scan });
      this.workers.push({ name: DOWNLOADS_QUEUE_NAME, worker: downloads });
      this.workers.push({ name: SCAN_QUEUE_NAME, worker: adminScan });
      this.logger.log(
        `started 3 BullMQ workers on queue=scan, ${DOWNLOADS_QUEUE_NAME}, ${SCAN_QUEUE_NAME}`,
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

  /**
   * PR-N4 — handle one admin scan job end-to-end. The worker
   * discovers the file list, walks it, and bridges each file
   * through the existing {@link ScanProcessor} so the admin
   * path reuses the same sidecar spawn contract (path
   * sanitization, output cap, retry budget).
   *
   * PR-N7 (issue #92) — observability: the bare worker is
   * wrapped in {@link instrumentAdminScanWorker} so each
   * terminal transition bumps the
   * ``scan_jobs_total{status=...}`` counter and the
   * ``scan_job_duration_seconds`` histogram. The wrapper
   * re-throws so BullMQ keeps the existing failure handling.
   */
  private async runAdminScan(payload: AdminScanJobPayload): Promise<void> {
    const baseWorker = new AdminScanWorker(
      this.scanRepo,
      this.scanBus,
      async (path) => this.scanProcessor.handle({ path }),
      async (jobId) => this.discoverScanFiles(jobId),
    );
    const instrumented = instrumentAdminScanWorker(baseWorker, this.metrics);
    await instrumented.handle(payload);
  }

  /**
   * Recursively walk the library's ``root_path`` and return
   * every file path the worker should process. The walk is
   * best-effort: a missing directory yields an empty list
   * (the worker still transitions the job to ``done`` with
   * ``total_files = 0``).
   */
  private async discoverScanFiles(jobId: string): Promise<string[]> {
    const row = await this.scanRepo.getJob(jobId);
    if (!row || row.libraryId === null) {
      return [];
    }
    const library = await this.libraries.findById(row.libraryId);
    if (!library) return [];
    return walkLibrary(library.rootPath);
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
  imports: [
    DownloadsModule,
    LibrariesModule,
    forwardRef(() => ScanModule),
    ObservabilityModule,
  ],
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

// NOTE: BULLMQ_CONNECTION is registered above (not in a dedicated
// BullMqModule) for historical reasons. A future refactor could
// split it out so neither ScanModule nor WorkersModule have to
// import each other for the connection token.
