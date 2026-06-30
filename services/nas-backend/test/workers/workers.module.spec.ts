import { Test } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import {
  WorkersBootstrap,
  ScanJobPayload,
  buildQueueOptions,
  makeResilientProcessor,
} from '../../src/workers/workers.module';
import {
  ScanProcessor,
  SidecarError,
} from '../../src/workers/scan.processor';
import {
  DOWNLOADS_QUEUE_NAME,
  DownloadsProcessor,
} from '../../src/workers/downloads.processor';
import { DOWNLOADS_REPOSITORY } from '../../src/downloads/downloads.repository';
import { BULLMQ_CONNECTION } from '../../src/workers/bullmq.config';
import IORedis from 'ioredis';
import { MetricsService } from '../../src/observability/metrics.service';

/**
 * Contract tests for {@link WorkersBootstrap} (PR-2E, work unit 2).
 *
 *   - When ``BULLMQ_CONNECTION`` is provided AND Redis is
 *     reachable, the bootstrap starts the scan + downloads
 *     workers.
 *   - When ``BULLMQ_CONNECTION`` is null, the bootstrap logs a
 *     single warning and starts NO workers.
 *   - When ``BULLMQ_CONNECTION`` is provided but Redis is
 *     unreachable, the bootstrap logs a warning and starts NO
 *     workers (no exception leaks, no socket is left dangling).
 *
 * The "Redis unreachable" case is what makes the rest of the API
 * (auth, books, search, downloads HTTP) keep running in CI and
 * local dev without a live broker.
 */
class StubDownloadsRepository {
  async findById() {
    return null;
  }
  async updateProgress() {
    /* no-op */
  }
  async markCompleted() {
    /* no-op */
  }
  async insert() {
    return {} as never;
  }
  async listByDevice() {
    return [];
  }
  async listForDevice() {
    return [];
  }
  async findByBookId() {
    return [];
  }
  async findCompletedForDeviceAndBook() {
    return null;
  }
  async stats() {
    return { total: 0, completed: 0, top_books: [], top_devices: [] };
  }
  async topDevicesForBook() {
    return [];
  }
  async close() {
    /* no-op */
  }
}

/**
 * PR-N4 — stub the new collaborators the bootstrap now
 * requires for the admin scan wiring. ``scanRepo`` /
 * ``scanBus`` are never exercised in the "skip when Redis is
 * down" path; the stubs satisfy the type-checker and let the
 * no-op branches run.
 */
class StubScanRepository {
  async getJob() { return null; }
  async setJobStatus() { return null; }
  async setJobError() { return null; }
  async updateProgress() { return null; }
  async isCancelled() { return false; }
  async requestCancellation() { /* no-op */ }
  async insertJob() { return {} as never; }
  async listJobs() { return []; }
  async close() { /* no-op */ }
}

class StubLibrariesRepository {
  async findById() { return null; }
  async list() { return []; }
  async insert() { return {} as never; }
  async update() { return null; }
  async delete() { return true; }
  async setActiveForDevice() { /* no-op */ }
  async getActiveForDevice() { return null; }
  async listForDevice() { return []; }
  async close() { /* no-op */ }
}

describe('WorkersBootstrap', () => {
  // Suppress the bootstrap's intentional ``logger.warn`` output
  // during tests so the suite output stays clean.
  const originalWarn = Logger.prototype.warn.bind(Logger.prototype);
  beforeAll(() => {
    Logger.prototype.warn = (() => undefined) as never;
  });
  afterAll(() => {
    Logger.prototype.warn = originalWarn;
  });

  it('skips starting workers when BULLMQ_CONNECTION is null', async () => {
    const bootstrap = new WorkersBootstrap(
      null,
      new ScanProcessor(),
      new DownloadsProcessor(new StubDownloadsRepository()),
      new StubScanRepository() as never,
      // ``ScanEventBus`` constructor takes no args.
      new (require('../../src/admin/scan/scan-event-bus').ScanEventBus)(),
      new StubLibrariesRepository() as never,
      // PR-N7 — MetricsService for instrumentation. The bootstrap
      // is responsible for firing scan_jobs_total via the
      // instrumented worker; pass a real instance with the
      // registry created by onApplicationBootstrap() so the test
      // exercises the same code path as production.
      new MetricsService(),
    );
    await bootstrap.onModuleInit();
    // No exceptions, no workers started. Closing the bootstrap
    // is a no-op because no workers were ever created.
    await bootstrap.onApplicationShutdown();
  });

  it('skips starting workers when Redis is unreachable (no live broker)', async () => {
    // Point the client at a port nothing is listening on so the
    // ``pingRedis`` probe inside ``onModuleInit`` returns false.
    const client = new IORedis({
      host: '127.0.0.1',
      port: 1, // reserved, no broker
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
      connectTimeout: 200,
      retryStrategy: () => null, // do not retry; fail fast
    });
    const bootstrap = new WorkersBootstrap(
      client,
      new ScanProcessor(),
      new DownloadsProcessor(new StubDownloadsRepository()),
      new StubScanRepository() as never,
      new (require('../../src/admin/scan/scan-event-bus').ScanEventBus)(),
      new StubLibrariesRepository() as never,
      new MetricsService(),
    );
    // The probe caps the wait at 750ms; we extend the Jest
    // timeout slightly to absorb DNS / handshake overhead.
    await bootstrap.onModuleInit();
    // Disconnect eagerly so the unused socket is closed before
    // the next test starts. ``.disconnect`` is safe to call
    // even if the client never managed to connect.
    client.disconnect();
    await bootstrap.onApplicationShutdown();
  });
});

describe('ScanJobPayload contract', () => {
  it('carries the path and an optional sha256 hint', () => {
    const job: ScanJobPayload = { path: '/lib/x.epub' };
    expect(job.path).toBe('/lib/x.epub');
    expect(job.sha256_hint).toBeUndefined();
    const withHint: ScanJobPayload = {
      path: '/lib/y.pdf',
      sha256_hint: 'deadbeef',
    };
    expect(withHint.sha256_hint).toBe('deadbeef');
  });
});

describe('BullMQ module wiring', () => {
  it('exports the DownloadsProcessor + ScanProcessor + BULLMQ_CONNECTION', async () => {
    // Smoke test: the modules compile + the providers are
    // resolvable via NestJS DI. We override every external
    // dependency so the module can be built without a real DB
    // or Redis.
    const moduleRef = await Test.createTestingModule({
      providers: [
        ScanProcessor,
        DownloadsProcessor,
        {
          provide: DOWNLOADS_REPOSITORY,
          useValue: new StubDownloadsRepository(),
        },
        {
          provide: BULLMQ_CONNECTION,
          useValue: null,
        },
      ],
    }).compile();
    expect(moduleRef.get(ScanProcessor)).toBeInstanceOf(ScanProcessor);
    expect(moduleRef.get(DownloadsProcessor)).toBeInstanceOf(
      DownloadsProcessor,
    );
    await moduleRef.close();
  });

  it('exposes the downloads queue name constant for the worker', () => {
    expect(DOWNLOADS_QUEUE_NAME).toBe('downloads');
  });
});

/**
 * Resilience contract — 4R review #35.
 *
 * BullMQ workers MUST be wired with retry + DLQ defaults so a single
 * corrupt file does not block the queue forever. Workers MUST also
 * translate {@link SidecarError} into {@link UnrecoverableError} so
 * BullMQ skips further retries (corrupt input does not get better
 * with repetition).
 *
 * Tests cover the two surfaces we expose:
 *
 *   - ``buildQueueOptions`` — the shared default options factory
 *     (attempts, exponential backoff, removeOnComplete/Fail).
 *   - ``makeResilientProcessor`` — wraps a processor so a thrown
 *     {@link SidecarError} becomes {@link UnrecoverableError}
 *     before it reaches BullMQ's retry logic.
 */
describe('buildQueueOptions (#35 retry + DLQ defaults)', () => {
  it('caps attempts at 3 with exponential backoff (5s base)', () => {
    const opts = buildQueueOptions();
    expect(opts.attempts).toBe(3);
    expect(opts.backoff).toEqual({ type: 'exponential', delay: 5000 });
  });

  it('trims completed jobs after 1h (age) or 1000 (count)', () => {
    const opts = buildQueueOptions();
    expect(opts.removeOnComplete).toEqual({ age: 3600, count: 1000 });
  });

  it('keeps failed jobs for 24h so an operator can inspect them', () => {
    const opts = buildQueueOptions();
    expect(opts.removeOnFail).toEqual({ age: 86400 });
  });
});

describe('makeResilientProcessor (#35 SidecarError → UnrecoverableError)', () => {
  it('translates a SidecarError into an UnrecoverableError', async () => {
    const inner = async (): Promise<unknown> => {
      throw new SidecarError({
        code: 'FILE_UNREADABLE',
        exitCode: 5,
        stderr: 'python: error: file not found\n',
        envelope: null,
      });
    };
    const wrapped = makeResilientProcessor(inner);
    await expect(wrapped({} as never)).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });

  it('preserves the SidecarError diagnostic message on the translated error', async () => {
    const inner = async (): Promise<unknown> => {
      throw new SidecarError({
        code: 'BACKEND_UNAVAILABLE',
        exitCode: 7,
        stderr: 'tesseract: missing data files',
        envelope: null,
      });
    };
    const wrapped = makeResilientProcessor(inner);
    // BullMQ's failed-job ``failedReason`` is the error message;
    // operators rely on it to triage why the file was rejected, so
    // the wrapped error MUST carry the SidecarError's diagnostic
    // text verbatim — NOT just "UnrecoverableError".
    await expect(wrapped({} as never)).rejects.toThrow(
      /tesseract: missing data files/,
    );
  });

  it('passes transient (non-Sidecar) errors through unchanged so BullMQ retries them', async () => {
    const inner = async (): Promise<unknown> => {
      throw new Error('redis connection lost');
    };
    const wrapped = makeResilientProcessor(inner);
    // Must NOT be UnrecoverableError — BullMQ should retry transient failures.
    await expect(wrapped({} as never)).rejects.toThrow(
      'redis connection lost',
    );
    await expect(wrapped({} as never)).rejects.not.toBeInstanceOf(
      UnrecoverableError,
    );
  });

  it('resolves with the inner result on success', async () => {
    const inner = async (): Promise<unknown> => ({ ok: 1 });
    const wrapped = makeResilientProcessor(inner);
    await expect(wrapped({} as never)).resolves.toEqual({ ok: 1 });
  });

  it('translates every SidecarError variant (FILE_UNREADABLE + INVALID_PATH) to UnrecoverableError', async () => {
    for (const code of ['FILE_UNREADABLE', 'INVALID_PATH', 'SPAWN_FAILED']) {
      const inner = async (): Promise<unknown> => {
        throw new SidecarError({
          code,
          exitCode: 1,
          stderr: `${code} simulated`,
          envelope: null,
        });
      };
      const wrapped = makeResilientProcessor(inner);
      await expect(wrapped({} as never)).rejects.toBeInstanceOf(
        UnrecoverableError,
      );
    }
  });
});
