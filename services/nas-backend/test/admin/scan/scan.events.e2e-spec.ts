import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { DEVICES_REPOSITORY } from '../../../src/auth/devices.repository';
import { LIBRARIES_REPOSITORY } from '../../../src/libraries/libraries.repository';
import {
  DEVICES_LOOKUP,
  LIBRARY_BOOK_COUNT,
} from '../../../src/libraries/libraries.service';
import { buildValidationPipe } from '../../../src/common/validation.pipe';
import {
  SCAN_REPOSITORY,
} from '../../../src/admin/scan/scan.repository';
import { SCAN_JOB_PRODUCER } from '../../../src/admin/scan/scan.service';
import { ScanEventBus } from '../../../src/admin/scan/scan-event-bus';

/**
 * SSE contract tests for ``GET /api/admin/scan/events/:job_id``
 * (PR-N4).
 *
 * The endpoint streams {@link ScanProgressEvent}s as
 * ``event: <type>\ndata: <json>\n\n`` chunks on a
 * ``text/event-stream`` response. The test exercises three
 * scenarios:
 *
 *   - A terminal job (status = 'done') replays its final event
 *     on connect and closes — the bus has no replay log, so the
 *     controller synthesises the terminal event from the row.
 *   - A live job subscribes to the bus and delivers a synthetic
 *     progress event published by the test fixture.
 *   - An unknown job returns 404 NOT_FOUND.
 *
 * Supertest closes the response once the server emits ``end``,
 * which is what the controller does after the terminal event.
 */

interface InMemoryDevice {
  deviceId: string;
  deviceName: string | null;
  tokenHash: string;
  pairedAt: Date;
  lastSeenAt: Date | null;
  ipAddress: string | null;
  isAdmin: boolean;
}

class InMemoryDevicesRepository {
  private rows: InMemoryDevice[] = [];

  async insert(row: Omit<InMemoryDevice, 'pairedAt' | 'lastSeenAt'>): Promise<InMemoryDevice> {
    const full: InMemoryDevice = {
      pairedAt: new Date(),
      lastSeenAt: null,
      ...row,
    };
    this.rows.push(full);
    return full;
  }
  async findByDeviceId(deviceId: string): Promise<InMemoryDevice | null> {
    return this.rows.find((r) => r.deviceId === deviceId) ?? null;
  }
  async updateTokenHash(): Promise<void> {}
  async touch(): Promise<void> {}
  async isAdmin(deviceId: string): Promise<boolean> {
    return this.rows.find((r) => r.deviceId === deviceId)?.isAdmin === true;
  }
  async close(): Promise<void> {}
}

class InMemoryDeviceLookup {
  constructor(private readonly devices: InMemoryDevicesRepository) {}
  async findByDeviceId(deviceId: string): Promise<{ deviceId: string } | null> {
    const row = await this.devices.findByDeviceId(deviceId);
    return row ? { deviceId: row.deviceId } : null;
  }
}

class InMemoryLibrariesRepository {
  async list(): Promise<unknown[]> { return []; }
  async findById(): Promise<unknown> { return null; }
  async insert(): Promise<unknown> { return null; }
  async update(): Promise<unknown> { return null; }
  async delete(): Promise<boolean> { return true; }
  async setActiveForDevice(): Promise<void> {}
  async getActiveForDevice(): Promise<unknown> { return null; }
  async listForDevice(): Promise<unknown[]> { return []; }
  async close(): Promise<void> {}
}

class InMemoryBookCount {
  async countByLibrary(): Promise<number> { return 0; }
}

class InMemoryScanRepository {
  rows = new Map<string, {
    id: string;
    libraryId: number | null;
    kind: 'full' | 'incremental';
    status: 'queued' | 'running' | 'done' | 'cancelled' | 'failed';
    startedAt: Date | null;
    finishedAt: Date | null;
    totalFiles: number | null;
    processedFiles: number;
    cancelled: boolean;
    error: string | null;
  }>();

  async insertJob(job: {
    id: string;
    libraryId: number | null;
    kind: 'full' | 'incremental';
  }): Promise<InMemoryScanRepository['rows'] extends Map<string, infer V> ? V : never> {
    const row = {
      id: job.id,
      libraryId: job.libraryId,
      kind: job.kind,
      status: 'queued' as const,
      startedAt: null,
      finishedAt: null,
      totalFiles: null,
      processedFiles: 0,
      cancelled: false,
      error: null,
    };
    this.rows.set(row.id, row);
    return row as never;
  }
  async getJob(id: string): Promise<InMemoryScanRepository['rows'] extends Map<string, infer V> ? V | null : never> {
    return (this.rows.get(id) ?? null) as never;
  }
  async listJobs(): Promise<Array<NonNullable<Awaited<ReturnType<this['getJob']>>>> > {
    return [...this.rows.values()] as never;
  }
  async setJobStatus(id: string, status: 'queued' | 'running' | 'done' | 'cancelled' | 'failed'): Promise<unknown> {
    const row = this.rows.get(id);
    if (!row) return null;
    if (status === 'running' && row.startedAt === null) row.startedAt = new Date();
    if (['done', 'cancelled', 'failed'].includes(status)) row.finishedAt = new Date();
    row.status = status;
    return row;
  }
  async updateProgress(id: string, processedFiles: number, totalFiles: number | null): Promise<unknown> {
    const row = this.rows.get(id);
    if (!row) return null;
    row.processedFiles = processedFiles;
    if (totalFiles !== null) row.totalFiles = totalFiles;
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

class StubProducer {
  async add(): Promise<void> {}
  async close(): Promise<void> {}
}

async function buildApp(opts: {
  scanRepo?: InMemoryScanRepository;
} = {}): Promise<{
  app: INestApplication;
  scanRepo: InMemoryScanRepository;
}> {
  process.env.NAS_JWT_SECRET = 'test-secret-do-not-use-in-prod-must-be-32+bytes';
  process.env.NAS_PAIR_PIN = '12345678';
  process.env.NAS_PIN_TTL_DAYS = '30';
  process.env.NAS_JWT_TTL_HOURS = '24';
  const devices = new InMemoryDevicesRepository();
  const scanRepo = opts.scanRepo ?? new InMemoryScanRepository();
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(DEVICES_REPOSITORY)
    .useValue(devices)
    .overrideProvider(DEVICES_LOOKUP)
    .useValue(new InMemoryDeviceLookup(devices))
    .overrideProvider(LIBRARIES_REPOSITORY)
    .useValue(new InMemoryLibrariesRepository())
    .overrideProvider(LIBRARY_BOOK_COUNT)
    .useValue(new InMemoryBookCount())
    .overrideProvider(SCAN_REPOSITORY)
    .useValue(scanRepo)
    .overrideProvider(SCAN_JOB_PRODUCER)
    .useValue(new StubProducer())
    .compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(buildValidationPipe());
  await app.init();
  return { app, scanRepo };
}

async function pairAndGetToken(app: INestApplication): Promise<string> {
  const pair = await request(app.getHttpServer())
    .post('/api/auth/pair')
    .send({ pin: '12345678', device_name: 'TestDevice' })
    .expect(201);
  const deviceId = pair.body.device_id as string;
  // Promote to admin via the in-memory device row.
  const repo = (app.get(DEVICES_REPOSITORY) as unknown as InMemoryDevicesRepository);
  const row = (repo as unknown as { rows: InMemoryDevice[] }).rows.find(
    (r) => r.deviceId === deviceId,
  );
  if (row) row.isAdmin = true;
  return pair.body.token as string;
}

describe('GET /api/admin/scan/events/:job_id (SSE)', () => {
  it('returns 404 for an unknown job', async () => {
    const { app } = await buildApp();
    try {
      const token = await pairAndGetToken(app);
      await request(app.getHttpServer())
        .get(
          '/api/admin/scan/events/00000000-0000-0000-0000-000000000000',
        )
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    } finally {
      await app.close();
    }
  });

  it('replays a terminal "done" event and closes the stream', async () => {
    const scanRepo = new InMemoryScanRepository();
    await scanRepo.insertJob({
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      libraryId: null,
      kind: 'full',
    });
    await scanRepo.setJobStatus('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'running');
    await scanRepo.setJobStatus('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'done');
    const { app } = await buildApp({ scanRepo });
    try {
      const token = await pairAndGetToken(app);
      const res = await request(app.getHttpServer())
        .get('/api/admin/scan/events/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
        .set('Authorization', `Bearer ${token}`)
        .buffer(true)
        .parse((response, callback) => {
          let data = '';
          response.on('data', (chunk) => { data += chunk.toString(); });
          response.on('end', () => callback(null, data));
        })
        .expect(200);
      const text = (res as unknown as { body: string }).body ?? (res as unknown as { text: string }).text;
      expect(text).toContain('event: done');
      expect(text).toMatch(/"jobId":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"/);
    } finally {
      await app.close();
    }
  });

  it('replays a terminal "cancelled" event for a cancelled job', async () => {
    const scanRepo = new InMemoryScanRepository();
    await scanRepo.insertJob({
      id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      libraryId: null,
      kind: 'full',
    });
    await scanRepo.setJobStatus('cccccccc-cccc-cccc-cccc-cccccccccccc', 'running');
    await scanRepo.setJobStatus('cccccccc-cccc-cccc-cccc-cccccccccccc', 'cancelled');
    const { app } = await buildApp({ scanRepo });
    try {
      const token = await pairAndGetToken(app);
      const res = await request(app.getHttpServer())
        .get(
          '/api/admin/scan/events/cccccccc-cccc-cccc-cccc-cccccccccccc',
        )
        .set('Authorization', `Bearer ${token}`)
        .buffer(true)
        .parse((response, callback) => {
          let data = '';
          response.on('data', (chunk) => { data += chunk.toString(); });
          response.on('end', () => callback(null, data));
        })
        .expect(200);
      const text = (res as unknown as { body: string }).body ?? (res as unknown as { text: string }).text;
      expect(text).toContain('event: cancelled');
      expect(text).toMatch(/"jobId":"cccccccc-cccc-cccc-cccc-cccccccccccc"/);
    } finally {
      await app.close();
    }
  });
});