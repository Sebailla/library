import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DEVICES_REPOSITORY } from '../src/auth/devices.repository';
import { LIBRARIES_REPOSITORY } from '../src/libraries/libraries.repository';
import {
  DEVICES_LOOKUP,
  LIBRARY_BOOK_COUNT,
} from '../src/libraries/libraries.service';
import { buildValidationPipe } from '../src/common/validation.pipe';
import {
  Library,
  LibraryPatch,
  NewLibrary,
} from '../src/libraries/libraries.types';

/**
 * End-to-end contract tests for the multi-library HTTP surface
 * shipped in PR-N2.
 *
 *   GET    /api/libraries              → 200 LibraryDto[]
 *   POST   /api/libraries              → 201 LibraryDto
 *   GET    /api/libraries/:id          → 200 LibraryDto | 404 NOT_FOUND
 *   PATCH  /api/libraries/:id          → 200 | 403 FORBIDDEN | 404 NOT_FOUND
 *   DELETE /api/libraries/:id          → 204 | 403 FORBIDDEN | 404 | 409 LIBRARY_NOT_EMPTY
 *   PUT    /api/libraries/:id/active   → 200 | 404 NOT_FOUND
 *
 * Every route sits behind ``JwtAuthGuard``. The libraries
 * service is the one that decides creator-only PATCH/DELETE,
 * not the controller, so the e2e contract is the wire shape
 * (status code + body) the controller hands to NestJS after
 * delegating to the service.
 *
 * Repositories are stubbed in-process so the suite pins the
 * HTTP contract without requiring a live Postgres + pgroonga.
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

/* ---------- in-memory devices (for JWT pair + lookup) ---------- */

class InMemoryDevicesRepository {
  private rows: Array<{
    deviceId: string;
    deviceName: string | null;
    tokenHash: string;
    pairedAt: Date;
    lastSeenAt: Date | null;
    ipAddress: string | null;
  }> = [];

  async insert(row: {
    deviceId: string;
    deviceName: string | null;
    tokenHash: string;
    ipAddress: string | null;
  }): Promise<{ deviceId: string; pairedAt: Date }> {
    const pairedAt = new Date();
    this.rows.push({
      deviceId: row.deviceId,
      deviceName: row.deviceName,
      tokenHash: row.tokenHash,
      pairedAt,
      lastSeenAt: null,
      ipAddress: row.ipAddress,
    });
    return { deviceId: row.deviceId, pairedAt };
  }

  async findByDeviceId(deviceId: string): Promise<{
    deviceId: string;
    deviceName: string | null;
    tokenHash: string;
    pairedAt: Date;
    lastSeenAt: Date | null;
    ipAddress: string | null;
  } | null> {
    return this.rows.find((r) => r.deviceId === deviceId) ?? null;
  }

  async updateTokenHash(deviceId: string, tokenHash: string): Promise<void> {
    const row = this.rows.find((r) => r.deviceId === deviceId);
    if (row) row.tokenHash = tokenHash;
  }

  async touch(deviceId: string): Promise<void> {
    const row = this.rows.find((r) => r.deviceId === deviceId);
    if (row) row.lastSeenAt = new Date();
  }

  async close(): Promise<void> {}
}

/* ---------- in-memory libraries repository ---------- */

class InMemoryLibrariesRepository {
  private rows: Library[] = [];
  private nextId = 1;
  private activeRows: Map<string, number> = new Map(); // deviceId -> libraryId

  async list(): Promise<Library[]> {
    return [...this.rows].sort((a, b) => a.id - b.id);
  }

  async findById(id: number): Promise<Library | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }

  async insert(library: NewLibrary): Promise<Library> {
    const row: Library = {
      id: this.nextId++,
      name: library.name,
      rootPath: library.rootPath,
      createdByDeviceId: library.createdByDeviceId,
      createdAt: new Date(),
    };
    this.rows.push(row);
    return row;
  }

  async update(id: number, patch: LibraryPatch): Promise<Library | null> {
    const idx = this.rows.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    const current = this.rows[idx]!;
    const next: Library = {
      ...current,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.rootPath !== undefined ? { rootPath: patch.rootPath } : {}),
    };
    this.rows[idx] = next;
    return next;
  }

  async delete(id: number): Promise<boolean> {
    const idx = this.rows.findIndex((r) => r.id === id);
    if (idx === -1) return false;
    this.rows.splice(idx, 1);
    // Cascade: any device whose active library was this id
    // loses it. (Stays as a per-device flag, just the library
    // id is gone; the route never reads it back.)
    for (const [deviceId, activeId] of this.activeRows) {
      if (activeId === id) this.activeRows.delete(deviceId);
    }
    return true;
  }

  async setActiveForDevice(deviceId: string, libraryId: number): Promise<void> {
    this.activeRows.set(deviceId, libraryId);
  }

  async getActiveForDevice(deviceId: string): Promise<Library | null> {
    const activeId = this.activeRows.get(deviceId);
    if (activeId === undefined) return null;
    return this.findById(activeId);
  }

  async close(): Promise<void> {}
}

class InMemoryDeviceLookup {
  constructor(private readonly devices: InMemoryDevicesRepository) {}

  async findByDeviceId(
    deviceId: string,
  ): Promise<{ deviceId: string } | null> {
    const row = await this.devices.findByDeviceId(deviceId);
    return row ? { deviceId: row.deviceId } : null;
  }
}

class InMemoryBookCount {
  private counts: Map<number, number> = new Map();

  set(libraryId: number, count: number): void {
    this.counts.set(libraryId, count);
  }

  async countByLibrary(libraryId: number): Promise<number> {
    return this.counts.get(libraryId) ?? 0;
  }
}

/* ---------- helpers ---------- */

async function buildApp(opts: {
  libraries?: InMemoryLibrariesRepository;
  bookCounts?: Map<number, number>;
} = {}): Promise<{
  app: INestApplication;
  libraries: InMemoryLibrariesRepository;
  bookCounts: InMemoryBookCount;
  devices: InMemoryDevicesRepository;
}> {
  setEnv({
    NAS_PAIR_PIN: '12345678',
    NAS_PIN_TTL_DAYS: '30',
    NAS_JWT_SECRET: 'test-secret-do-not-use-in-prod-must-be-32+bytes',
    NAS_JWT_TTL_HOURS: '24',
  });
  const devices = new InMemoryDevicesRepository();
  const libraries = opts.libraries ?? new InMemoryLibrariesRepository();
  const bookCounts = new InMemoryBookCount();
  for (const [id, count] of opts.bookCounts ?? []) {
    bookCounts.set(id, count);
  }
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(DEVICES_REPOSITORY)
    .useValue(devices)
    .overrideProvider(LIBRARIES_REPOSITORY)
    .useValue(libraries)
    .overrideProvider(DEVICES_LOOKUP)
    .useValue(new InMemoryDeviceLookup(devices))
    .overrideProvider(LIBRARY_BOOK_COUNT)
    .useValue(bookCounts)
    .compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(buildValidationPipe());
  await app.init();
  return { app, libraries, bookCounts, devices };
}

async function pairAndGetToken(
  app: INestApplication,
  name = 'TestDevice',
): Promise<string> {
  const pair = await request(app.getHttpServer())
    .post('/api/auth/pair')
    .send({ pin: '12345678', device_name: name })
    .expect(201);
  return pair.body.token as string;
}

/* ---------- GET /api/libraries ---------- */

describe('GET /api/libraries (list)', () => {
  afterEach(() => {
    restoreEnv();
  });

  it('returns 401 UNAUTHORIZED without a Bearer token', async () => {
    const { app } = await buildApp();
    try {
      await request(app.getHttpServer())
        .get('/api/libraries')
        .expect(401);
    } finally {
      await app.close();
    }
  });

  it('returns an empty array when no library exists', async () => {
    const { app } = await buildApp();
    try {
      const token = await pairAndGetToken(app);
      const res = await request(app.getHttpServer())
        .get('/api/libraries')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('returns every library with the documented snake_case DTO', async () => {
    const libraries = new InMemoryLibrariesRepository();
    await libraries.insert({
      name: 'Borges',
      rootPath: '/lib/borges',
      createdByDeviceId: null,
    });
    await libraries.insert({
      name: 'Biología',
      rootPath: '/lib/biologia',
      createdByDeviceId: null,
    });
    const { app } = await buildApp({ libraries });
    try {
      const token = await pairAndGetToken(app);
      const res = await request(app.getHttpServer())
        .get('/api/libraries')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0]).toMatchObject({
        name: 'Borges',
        root_path: '/lib/borges',
      });
      expect(res.body[0].id).toBe(1);
      expect(typeof res.body[0].created_at).toBe('string');
    } finally {
      await app.close();
    }
  });
});

/* ---------- POST /api/libraries ---------- */

describe('POST /api/libraries (create)', () => {
  afterEach(() => {
    restoreEnv();
  });

  it('returns 401 UNAUTHORIZED without a Bearer token', async () => {
    const { app } = await buildApp();
    try {
      await request(app.getHttpServer())
        .post('/api/libraries')
        .send({ name: 'X', root_path: '/x' })
        .expect(401);
    } finally {
      await app.close();
    }
  });

  it('returns 201 and the library DTO with created_by_device_id set', async () => {
    const { app } = await buildApp();
    try {
      const token = await pairAndGetToken(app);
      const res = await request(app.getHttpServer())
        .post('/api/libraries')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Borges', root_path: '/lib/borges' })
        .expect(201);
      expect(res.body).toMatchObject({
        id: expect.any(Number),
        name: 'Borges',
        root_path: '/lib/borges',
        created_by_device_id: expect.any(String),
      });
      // The created_by_device_id is the device UUID, not the
      // device's human-readable name.
      expect(res.body.created_by_device_id).not.toBe('TestDevice');
      expect(typeof res.body.created_at).toBe('string');
    } finally {
      await app.close();
    }
  });

  it('rejects an empty name with 400 from the global ValidationPipe', async () => {
    const { app } = await buildApp();
    try {
      const token = await pairAndGetToken(app);
      await request(app.getHttpServer())
        .post('/api/libraries')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: '', root_path: '/x' })
        .expect(400);
    } finally {
      await app.close();
    }
  });

  it('rejects a missing root_path with 400 from the global ValidationPipe', async () => {
    const { app } = await buildApp();
    try {
      const token = await pairAndGetToken(app);
      await request(app.getHttpServer())
        .post('/api/libraries')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'X' })
        .expect(400);
    } finally {
      await app.close();
    }
  });
});

/* ---------- GET /api/libraries/:id ---------- */

describe('GET /api/libraries/:id (detail)', () => {
  afterEach(() => {
    restoreEnv();
  });

  it('returns 200 with the library DTO when the row exists', async () => {
    const libraries = new InMemoryLibrariesRepository();
    const created = await libraries.insert({
      name: 'Mine',
      rootPath: '/lib/mine',
      createdByDeviceId: null,
    });
    const { app } = await buildApp({ libraries });
    try {
      const token = await pairAndGetToken(app);
      const res = await request(app.getHttpServer())
        .get(`/api/libraries/${created.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body).toMatchObject({
        id: created.id,
        name: 'Mine',
        root_path: '/lib/mine',
      });
    } finally {
      await app.close();
    }
  });

  it('returns 404 NOT_FOUND when the library does not exist', async () => {
    const { app } = await buildApp();
    try {
      const token = await pairAndGetToken(app);
      const res = await request(app.getHttpServer())
        .get('/api/libraries/9999')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
      expect(res.body.error).toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      await app.close();
    }
  });
});

/* ---------- PATCH /api/libraries/:id ---------- */

describe('PATCH /api/libraries/:id (update)', () => {
  afterEach(() => {
    restoreEnv();
  });

  it('returns 200 for the creator with the patched DTO', async () => {
    const { app } = await buildApp();
    try {
      const token = await pairAndGetToken(app, 'Creator');
      const created = await request(app.getHttpServer())
        .post('/api/libraries')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Old', root_path: '/lib/old' })
        .expect(201);
      const res = await request(app.getHttpServer())
        .patch(`/api/libraries/${created.body.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'New' })
        .expect(200);
      expect(res.body.name).toBe('New');
      expect(res.body.root_path).toBe('/lib/old');
    } finally {
      await app.close();
    }
  });

  it('returns 403 FORBIDDEN when the caller is not the creator', async () => {
    const { app } = await buildApp();
    try {
      const tokenA = await pairAndGetToken(app, 'Creator');
      const tokenB = await pairAndGetToken(app, 'Intruder');
      const created = await request(app.getHttpServer())
        .post('/api/libraries')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Mine', root_path: '/lib/mine' })
        .expect(201);
      const res = await request(app.getHttpServer())
        .patch(`/api/libraries/${created.body.id}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ name: 'Hijacked' })
        .expect(403);
      expect(res.body.error).toMatchObject({ code: 'FORBIDDEN' });
    } finally {
      await app.close();
    }
  });

  it('returns 404 NOT_FOUND when the library does not exist', async () => {
    const { app } = await buildApp();
    try {
      const token = await pairAndGetToken(app);
      const res = await request(app.getHttpServer())
        .patch('/api/libraries/9999')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'X' })
        .expect(404);
      expect(res.body.error).toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      await app.close();
    }
  });
});

/* ---------- DELETE /api/libraries/:id ---------- */

describe('DELETE /api/libraries/:id', () => {
  afterEach(() => {
    restoreEnv();
  });

  it('returns 204 when the creator deletes an empty library', async () => {
    const { app } = await buildApp();
    try {
      const token = await pairAndGetToken(app);
      const created = await request(app.getHttpServer())
        .post('/api/libraries')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Doomed', root_path: '/lib/doomed' })
        .expect(201);
      await request(app.getHttpServer())
        .delete(`/api/libraries/${created.body.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);
      // And the row is gone.
      await request(app.getHttpServer())
        .get(`/api/libraries/${created.body.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    } finally {
      await app.close();
    }
  });

  it('returns 403 FORBIDDEN when the caller is not the creator', async () => {
    const { app } = await buildApp();
    try {
      const tokenA = await pairAndGetToken(app, 'Creator');
      const tokenB = await pairAndGetToken(app, 'Intruder');
      const created = await request(app.getHttpServer())
        .post('/api/libraries')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Mine', root_path: '/lib/mine' })
        .expect(201);
      const res = await request(app.getHttpServer())
        .delete(`/api/libraries/${created.body.id}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(403);
      expect(res.body.error).toMatchObject({ code: 'FORBIDDEN' });
    } finally {
      await app.close();
    }
  });

  it('returns 409 LIBRARY_NOT_EMPTY when the library has books indexed', async () => {
    // Build the wiring ONCE so the paired device survives
    // into the second app instance. The library is created
    // via the API (so createdByDeviceId is the bearer
    // device) and the book-count seam is seeded with the
    // resulting id.
    const libraries = new InMemoryLibrariesRepository();
    const devices = new InMemoryDevicesRepository();
    const bookCounts = new InMemoryBookCount();
    setEnv({
      NAS_PAIR_PIN: '12345678',
      NAS_PIN_TTL_DAYS: '30',
      NAS_JWT_SECRET: 'test-secret-do-not-use-in-prod-must-be-32+bytes',
      NAS_JWT_TTL_HOURS: '24',
    });
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DEVICES_REPOSITORY)
      .useValue(devices)
      .overrideProvider(LIBRARIES_REPOSITORY)
      .useValue(libraries)
      .overrideProvider(DEVICES_LOOKUP)
      .useValue(new InMemoryDeviceLookup(devices))
      .overrideProvider(LIBRARY_BOOK_COUNT)
      .useValue(bookCounts)
      .compile();
    const app = moduleRef.createNestApplication();
    app.useGlobalPipes(buildValidationPipe());
    await app.init();
    try {
      const token = await pairAndGetToken(app);
      const created = await request(app.getHttpServer())
        .post('/api/libraries')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Busy', root_path: '/lib/busy' })
        .expect(201);
      // Seed the book count AFTER the library is created so
      // the id matches.
      bookCounts.set(created.body.id, 5);
      const res = await request(app.getHttpServer())
        .delete(`/api/libraries/${created.body.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);
      expect(res.body.error).toMatchObject({ code: 'LIBRARY_NOT_EMPTY' });
    } finally {
      await app.close();
    }
  });
});

/* ---------- PUT /api/libraries/:id/active ---------- */

describe('PUT /api/libraries/:id/active', () => {
  afterEach(() => {
    restoreEnv();
  });

  it('returns 200 with the library DTO when the row exists', async () => {
    const libraries = new InMemoryLibrariesRepository();
    const created = await libraries.insert({
      name: 'Mine',
      rootPath: '/lib/mine',
      createdByDeviceId: null,
    });
    const { app } = await buildApp({ libraries });
    try {
      const token = await pairAndGetToken(app);
      const res = await request(app.getHttpServer())
        .put(`/api/libraries/${created.id}/active`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body).toMatchObject({
        id: created.id,
        name: 'Mine',
        root_path: '/lib/mine',
      });
    } finally {
      await app.close();
    }
  });

  it('returns 404 NOT_FOUND when the library does not exist', async () => {
    const { app } = await buildApp();
    try {
      const token = await pairAndGetToken(app);
      const res = await request(app.getHttpServer())
        .put('/api/libraries/9999/active')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
      expect(res.body.error).toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      await app.close();
    }
  });
});
