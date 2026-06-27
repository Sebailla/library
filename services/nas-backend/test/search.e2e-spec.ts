import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DEVICES_REPOSITORY } from '../src/auth/devices.repository';
import { SEARCH_REPOSITORY } from '../src/search/search.repository';

/**
 * End-to-end contract tests for the search route shipped in PR-2D
 * (work unit 4 — pgroonga-backed full-text search).
 *
 *   GET /api/search?q=...&limit=20&offset=0
 *     → 200 {data: SearchHitDto[], total: number}
 *
 * Results are ranked by pgroonga score (descending). The route
 * requires a valid Bearer token (PR-2C ``JwtAuthGuard``).
 *
 * The repository is stubbed in-process so the suite pins the HTTP
 * contract without requiring a live Postgres + pgroonga instance.
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
      ipAddress: row.ipAddress,
      pairedAt,
      lastSeenAt: null,
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

interface InMemorySearchHit {
  id: number;
  title: string;
  authorId: number | null;
  score: number;
}

class InMemorySearchRepository {
  // Pre-seeded hits for known queries so the in-memory stub can
  // simulate pgroonga's relevance ranking.
  private fixtures: Map<string, InMemorySearchHit[]> = new Map();
  private totalByQuery: Map<string, number> = new Map();

  setFixture(query: string, hits: InMemorySearchHit[]): void {
    this.fixtures.set(query, hits);
    this.totalByQuery.set(query, hits.length);
  }

  async search(
    query: string,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<{ rows: InMemorySearchHit[]; total: number }> {
    const hits = this.fixtures.get(query) ?? [];
    const total = this.totalByQuery.get(query) ?? 0;
    const offset = opts.offset ?? 0;
    const limit = opts.limit ?? 20;
    return { rows: hits.slice(offset, offset + limit), total };
  }

  async close(): Promise<void> {}
}

async function buildApp(opts: {
  search?: InMemorySearchRepository;
} = {}): Promise<{ app: INestApplication; search: InMemorySearchRepository }> {
  setEnv({
    NAS_PAIR_PIN: '0000',
    NAS_PIN_TTL_DAYS: '30',
    NAS_JWT_SECRET: 'test-secret-do-not-use-in-prod',
    NAS_JWT_TTL_HOURS: '24',
  });
  const devices = new InMemoryDevicesRepository();
  const search = opts.search ?? new InMemorySearchRepository();
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(DEVICES_REPOSITORY)
    .useValue(devices)
    .overrideProvider(SEARCH_REPOSITORY)
    .useValue(search)
    .compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return { app, search };
}

async function pairAndGetToken(app: INestApplication): Promise<string> {
  const pair = await request(app.getHttpServer())
    .post('/api/auth/pair')
    .send({ pin: '0000', device_name: 'TestDevice' })
    .expect(201);
  return pair.body.token as string;
}

describe('GET /api/search (pgroonga-backed full-text search)', () => {
  afterEach(() => {
    restoreEnv();
  });

  it('returns 401 UNAUTHORIZED without a Bearer token', async () => {
    const { app } = await buildApp();
    try {
      await request(app.getHttpServer())
        .get('/api/search?q=foo')
        .expect(401);
    } finally {
      await app.close();
    }
  });

  it('returns 400 when ?q is missing', async () => {
    const { app } = await buildApp();
    try {
      const token = await pairAndGetToken(app);
      const res = await request(app.getHttpServer())
        .get('/api/search')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
      // NestJS ValidationPipe defaults to { statusCode: 400,
      // message, error: 'Bad Request' }. The contract here is
      // "the server rejects the request when ?q is missing",
      // which is satisfied by the 400 status + presence of the
      // ``message`` field listing the failed constraint.
      expect(res.body.statusCode).toBe(400);
      expect(Array.isArray(res.body.message)).toBe(true);
      expect(
        (res.body.message as string[]).some((m) => m.includes('q')),
      ).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('returns books ranked by pgroonga score (descending)', async () => {
    const search = new InMemorySearchRepository();
    search.setFixture('soledad', [
      { id: 1, title: 'Cien años de soledad', authorId: 1, score: 0.95 },
      { id: 2, title: 'La soledad del manager', authorId: 2, score: 0.42 },
    ]);
    const { app } = await buildApp({ search });
    try {
      const token = await pairAndGetToken(app);
      const res = await request(app.getHttpServer())
        .get('/api/search?q=soledad')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0].title).toBe('Cien años de soledad');
      expect(res.body.data[0].score).toBeCloseTo(0.95);
      expect(res.body.data[1].title).toBe('La soledad del manager');
      expect(res.body.data[1].score).toBeCloseTo(0.42);
      expect(res.body.total).toBe(2);
    } finally {
      await app.close();
    }
  });

  it('honours ?limit and ?offset for pagination', async () => {
    const search = new InMemorySearchRepository();
    const hits: InMemorySearchHit[] = [];
    for (let i = 0; i < 30; i++) {
      hits.push({ id: i + 1, title: `Hit ${i}`, authorId: null, score: 1 - i / 100 });
    }
    search.setFixture('x', hits);
    const { app } = await buildApp({ search });
    try {
      const token = await pairAndGetToken(app);
      const res = await request(app.getHttpServer())
        .get('/api/search?q=x&limit=10&offset=20')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.data).toHaveLength(10);
      expect(res.body.total).toBe(30);
      // First hit on page 3 is hit index 20.
      expect(res.body.data[0].title).toBe('Hit 20');
      expect(res.body.data[9].title).toBe('Hit 29');
    } finally {
      await app.close();
    }
  });

  it('returns an empty result for a query with no matches', async () => {
    const search = new InMemorySearchRepository();
    // No fixture for 'nothing-matches-this'.
    const { app } = await buildApp({ search });
    try {
      const token = await pairAndGetToken(app);
      const res = await request(app.getHttpServer())
        .get('/api/search?q=nothing-matches-this')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.total).toBe(0);
    } finally {
      await app.close();
    }
  });
});