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
  ScanRepository,
} from '../../../src/admin/scan/scan.repository';
import { SCAN_JOB_PRODUCER } from '../../../src/admin/scan/scan.service';
import { Library, NewLibrary } from '../../../src/libraries/libraries.types';
import {
  NewScanJob,
  ScanJob,
  ScanJobKind,
  ScanJobStatus,
} from '../../../src/admin/scan/scan.types';

/**
 * End-to-end contract tests for the ``/api/admin/scan/*`` HTTP
 * surface shipped in PR-N4.
 *
 *   POST   /api/admin/scan/full         → 202 { job_id }    (admin)
 *   POST   /api/admin/scan/incremental  → 202 { job_id }    (admin)
 *   GET    /api/admin/scan/status       → 200 { jobs: [...] }
 *   GET    /api/admin/scan/status/:id   → 200 { job } | 404
 *   POST   /api/admin/scan/cancel/:id   → 200 { cancelled: bool }
 *   GET    /api/admin/scan/events/:id   → text/event-stream
 *
 * Every route sits behind ``JwtAuthGuard`` + ``ScanAdminGuard``.
 * The repositories are stubbed in-process so the suite pins the
 * HTTP contract without requiring a live Postgres + pgroonga.
 *
 * The BullMQ producer is also stubbed — the controller's job is
 * to record the queued row and ask the producer to enqueue; we
 * assert both via the in-memory repos below.
 */

const ORIGINAL_ENV = { ...process.env };

function setEnv(overrides: Record<string, string>): void {
  for (const [k, v] of Object.entries(overrides)) {
    process.env[k] = v;
  }
}

function restoreEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  }
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    process.env[k] = v;
  }
}

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

  async touch(deviceId: string): Promise<void> {
    const row = this.rows.find((r) => r.deviceId === deviceId);
    if (row) row.lastSeenAt = new Date();
  }

  async isAdmin(deviceId: string): Promise<boolean> {
    const row = this.rows.find((r) => r.deviceId === deviceId);
    return row?.isAdmin === true;
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
  private rows: Library[] = [];
  private nextId = 1;

  async list(): Promise<Library[]> {
    return [...this.rows];
  }
  async findById(id: number): Promise<Library | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async insert(library: NewLibrary): Promise<Library> {
    const row: Library = {
      id: this.nextId++,
      ...library,
      createdAt: new Date(),
    };
    this.rows.push(row);
    return row;
  }
  async update(): Promise<Library | null> {
    return null;
  }
  async delete(): Promise<boolean> {
    return true;
  }
  async setActiveForDevice(): Promise<void> {}
  async getActiveForDevice(): Promise<Library | null> {
    return null;
  }
  async listForDevice(): Promise<unknown[]> {
    return [];
  }
  async close(): Promise<void> {}
}

class InMemoryBookCount {
  async countByLibrary(): Promise<number> {
    return 0;
  }
}

class InMemoryScanRepository {
  private rows = new Map<string, ScanJob>();

  async insertJob(job: NewScanJob): Promise<ScanJob> {
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

  async updateProgress(
    id: string,
    processedFiles: number,
    totalFiles: number | null,
  ): Promise<ScanJob | null> {
    const row = this.rows.get(id);
    if (!row) return null;
    row.processedFiles = processedFiles;
    if (totalFiles !== null) row.totalFiles = totalFiles;
    return row;
  }

  async setJobError(id: string, error: string): Promise<ScanJob | null> {
    const row = this.rows.get(id);
    if (!row) return null;
    row.error = error;
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

class StubProducer {
  public jobs: Array<{ name: string; data: { jobId: string } }> = [];
  async add(name: string, data: { jobId: string }): Promise<void> {
    this.jobs.push({ name, data });
  }
  async close(): Promise<void> {}
}

async function buildApp(opts: {
  adminDeviceId?: string;
  libraries?: InMemoryLibrariesRepository;
  scanRepo?: InMemoryScanRepository;
  producer?: StubProducer;
} = {}): Promise<{
  app: INestApplication;
  devices: InMemoryDevicesRepository;
  libraries: InMemoryLibrariesRepository;
  scanRepo: InMemoryScanRepository;
  producer: StubProducer;
}> {
  setEnv({
    NAS_PAIR_PIN: '12345678',
    NAS_PIN_TTL_DAYS: '30',
    NAS_JWT_SECRET: 'test-secret-do-not-use-in-prod-must-be-32+bytes',
    NAS_JWT_TTL_HOURS: '24',
  });
  const devices = new InMemoryDevicesRepository();
  const libraries = opts.libraries ?? new InMemoryLibrariesRepository();
  const scanRepo = opts.scanRepo ?? new InMemoryScanRepository();
  const producer = opts.producer ?? new StubProducer();
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(DEVICES_REPOSITORY)
    .useValue(devices)
    .overrideProvider(DEVICES_LOOKUP)
    .useValue(new InMemoryDeviceLookup(devices))
    .overrideProvider(LIBRARIES_REPOSITORY)
    .useValue(libraries)
    .overrideProvider(LIBRARY_BOOK_COUNT)
    .useValue(new InMemoryBookCount())
    .overrideProvider(LIBRARIES_REPOSITORY)
    .useValue(libraries)
    .overrideProvider(SCAN_REPOSITORY)
    .useValue(scanRepo)
    .overrideProvider(SCAN_JOB_PRODUCER)
    .useValue({
      add: (data: { jobId: string }) => producer.add('scan', data),
      close: () => producer.close(),
    })
    // The controller wires a ScanService which needs a producer.
    // We override the BULLMQ_CONNECTION provider to null so the
    // WorkersBootstrap short-circuits, then wire a stub producer
    // through the SCAN_JOB_PRODUCER token below.
    .compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(buildValidationPipe());
  await app.init();
  return { app, devices, libraries, scanRepo, producer };
}

async function pairAndGetToken(
  app: INestApplication,
  devices: InMemoryDevicesRepository,
  isAdmin: boolean,
): Promise<string> {
  // Pre-seed a paired device so we can mint a bearer token directly
  // through ``POST /api/auth/pair``. The JWT secret is wired in
  // buildApp. After pairing we mark the device as admin if requested.
  const pair = await request(app.getHttpServer())
    .post('/api/auth/pair')
    .send({ pin: '12345678', device_name: 'TestDevice' })
    .expect(201);
  const token = pair.body.token as string;
  if (isAdmin) {
    const deviceId = pair.body.device_id as string;
    // Promote the freshly-paired device. The InMemoryDevicesRepository
    // keeps its own isAdmin flag; we flip it via the auth module's
    // internal seeding helper. The simplest path: reach into the
    // in-memory repo directly via the buildApp return value.
    const row = (devices as unknown as { rows: InMemoryDevice[] }).rows.find(
      (r) => r.deviceId === deviceId,
    );
    if (row) row.isAdmin = true;
  }
  return token;
}

describe('POST /api/admin/scan/full (enqueue full scan, admin only)', () => {
  afterEach(() => restoreEnv());

  it('returns 401 UNAUTHORIZED without a Bearer token', async () => {
    const { app } = await buildApp();
    try {
      await request(app.getHttpServer())
        .post('/api/admin/scan/full')
        .send({})
        .expect(401);
    } finally {
      await app.close();
    }
  });

  it('returns 403 ADMIN_REQUIRED for a non-admin bearer', async () => {
    const { app, devices } = await buildApp();
    try {
      const token = await pairAndGetToken(app, devices, false);
      const res = await request(app.getHttpServer())
        .post('/api/admin/scan/full')
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(403);
      expect(res.body.error.code).toBe('ADMIN_REQUIRED');
    } finally {
      await app.close();
    }
  });

  it('returns 202 + job_id for an admin bearer (whole-NAS when no library_id)', async () => {
    const { app, devices, scanRepo, producer } = await buildApp();
    try {
      const token = await pairAndGetToken(app, devices, true);
      const res = await request(app.getHttpServer())
        .post('/api/admin/scan/full')
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(202);
      expect(typeof res.body.job_id).toBe('string');
      expect(res.body.job_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      // The repository MUST hold the queued row.
      const stored = await scanRepo.getJob(res.body.job_id);
      expect(stored).not.toBeNull();
      expect(stored!.kind).toBe<ScanJobKind>('full');
      // The producer MUST have been asked to enqueue the same id.
      expect(producer.jobs.some((j) => j.data.jobId === res.body.job_id)).toBe(true);
    } finally {
      await app.close();
    }
  });
});

describe('POST /api/admin/scan/incremental (enqueue incremental, admin only)', () => {
  afterEach(() => restoreEnv());

  it('returns 202 + job_id for an admin bearer with a library_id', async () => {
    const libraries = new InMemoryLibrariesRepository();
    const lib = await libraries.insert({
      name: 'Borges',
      rootPath: '/lib/borges',
      createdByDeviceId: null,
    });
    const { app, devices, scanRepo, producer } = await buildApp({ libraries });
    try {
      const token = await pairAndGetToken(app, devices, true);
      const res = await request(app.getHttpServer())
        .post('/api/admin/scan/incremental')
        .set('Authorization', `Bearer ${token}`)
        .send({ library_id: lib.id })
        .expect(202);
      expect(typeof res.body.job_id).toBe('string');
      const stored = await scanRepo.getJob(res.body.job_id);
      expect(stored).not.toBeNull();
      expect(stored!.kind).toBe<ScanJobKind>('incremental');
      expect(stored!.libraryId).toBe(lib.id);
      expect(producer.jobs.some((j) => j.data.jobId === res.body.job_id)).toBe(true);
    } finally {
      await app.close();
    }
  });
});

describe('GET /api/admin/scan/status (list jobs, admin only)', () => {
  afterEach(() => restoreEnv());

  it('returns 200 + jobs array for an admin bearer', async () => {
    const scanRepo = new InMemoryScanRepository();
    await scanRepo.insertJob({
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      libraryId: null,
      kind: 'full',
    });
    const { app, devices } = await buildApp({ scanRepo });
    try {
      const token = await pairAndGetToken(app, devices, true);
      const res = await request(app.getHttpServer())
        .get('/api/admin/scan/status')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(Array.isArray(res.body.jobs)).toBe(true);
      expect(res.body.jobs).toHaveLength(1);
      expect(res.body.jobs[0].id).toBe(
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      );
    } finally {
      await app.close();
    }
  });
});

describe('GET /api/admin/scan/status/:id (single job, admin only)', () => {
  afterEach(() => restoreEnv());

  it('returns 200 for an existing job', async () => {
    const scanRepo = new InMemoryScanRepository();
    await scanRepo.insertJob({
      id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      libraryId: null,
      kind: 'full',
    });
    const { app, devices } = await buildApp({ scanRepo });
    try {
      const token = await pairAndGetToken(app, devices, true);
      const res = await request(app.getHttpServer())
        .get(
          '/api/admin/scan/status/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        )
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.job.id).toBe(
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      );
    } finally {
      await app.close();
    }
  });

  it('returns 404 for an unknown job', async () => {
    const { app, devices } = await buildApp();
    try {
      const token = await pairAndGetToken(app, devices, true);
      await request(app.getHttpServer())
        .get(
          '/api/admin/scan/status/cccccccc-cccc-cccc-cccc-cccccccccccc',
        )
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    } finally {
      await app.close();
    }
  });
});

describe('POST /api/admin/scan/cancel/:id (cancel, admin only)', () => {
  afterEach(() => restoreEnv());

  it('returns 200 + cancelled=true for a running job', async () => {
    const scanRepo = new InMemoryScanRepository();
    const inserted = await scanRepo.insertJob({
      id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      libraryId: null,
      kind: 'full',
    });
    await scanRepo.setJobStatus(inserted.id, 'running');
    const { app, devices } = await buildApp({ scanRepo });
    try {
      const token = await pairAndGetToken(app, devices, true);
      const res = await request(app.getHttpServer())
        .post(
          '/api/admin/scan/cancel/dddddddd-dddd-dddd-dddd-dddddddddddd',
        )
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.cancelled).toBe(true);
      expect(await scanRepo.isCancelled(inserted.id)).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('returns 200 + cancelled=false for an unknown job', async () => {
    const { app, devices } = await buildApp();
    try {
      const token = await pairAndGetToken(app, devices, true);
      const res = await request(app.getHttpServer())
        .post(
          '/api/admin/scan/cancel/eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
        )
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.cancelled).toBe(false);
    } finally {
      await app.close();
    }
  });
});