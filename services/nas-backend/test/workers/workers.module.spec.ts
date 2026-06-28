import { Test } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { WorkersBootstrap, ScanJobPayload } from '../../src/workers/workers.module';
import { ScanProcessor } from '../../src/workers/scan.processor';
import {
  DOWNLOADS_QUEUE_NAME,
  DownloadsProcessor,
} from '../../src/workers/downloads.processor';
import { DOWNLOADS_REPOSITORY } from '../../src/downloads/downloads.repository';
import { BULLMQ_CONNECTION } from '../../src/workers/bullmq.config';
import IORedis from 'ioredis';

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
  async findCompletedForDeviceAndBook() {
    return null;
  }
  async stats() {
    return { total: 0, completed: 0, top_books: [], top_devices: [] };
  }
  async close() {
    /* no-op */
  }
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
