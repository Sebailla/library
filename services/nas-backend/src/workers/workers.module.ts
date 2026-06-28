import {
  Inject,
  Injectable,
  Logger,
  Module,
  OnApplicationShutdown,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConnectionOptions, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { DownloadsModule } from '../downloads/downloads.module';
import { BULLMQ_CONNECTION, buildBullMqConnection } from './bullmq.config';
import {
  DOWNLOADS_QUEUE_NAME,
  DownloadsProcessor,
  makeDownloadsWorker,
} from './downloads.processor';
import { ScanProcessor } from './scan.processor';

/**
 * Wire-format for jobs enqueued on the ``scan`` queue. The actual
 * processor that consumes them is {@link ScanProcessor}.
 */
export interface ScanJobPayload {
  path: string;
  sha256_hint?: string;
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
      const scan = new Worker<ScanJobPayload, unknown>(
        'scan',
        async (job) => this.scanProcessor.handle(job.data),
        { connection: conn },
      );
      const downloads = makeDownloadsWorker(this.downloadsProcessor, conn);
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
