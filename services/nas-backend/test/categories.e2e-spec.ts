import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DEVICES_REPOSITORY } from '../src/auth/devices.repository';
import { CATEGORIES_REPOSITORY } from '../src/books/categories.repository';
import { buildValidationPipe } from '../src/common/validation.pipe';

/**
 * End-to-end contract tests for the categories tree route shipped in
 * PR-2D (work unit 3 — categories list).
 *
 *   GET /api/categories    → 200 {data: CategoryDto[]}
 *
 * Returns the seeded top-level categories (and their full sub-trees
 * via the recursive CTE exposed by ``CategoriesRepository.findSubtree``).
 *
 * The route requires a valid Bearer token (PR-2C ``JwtAuthGuard``).
 *
 * The repository is stubbed in-process so the suite pins the HTTP
 * contract without requiring a live Postgres + pgroonga.
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

interface InMemoryCategory {
  id: number;
  path: string;
  nameEs: string;
  nameEn: string;
  parentId: number | null;
  depth: number;
}

class InMemoryCategoriesRepository {
  private rows: InMemoryCategory[] = [];
  private nextId = 1;

  async insert(c: Omit<InMemoryCategory, 'id'>): Promise<InMemoryCategory> {
    const row: InMemoryCategory = { id: this.nextId++, ...c };
    this.rows.push(row);
    return row;
  }

  async findByPath(path: string): Promise<InMemoryCategory | null> {
    return this.rows.find((c) => c.path === path) ?? null;
  }

  async listRoots(): Promise<InMemoryCategory[]> {
    return [...this.rows]
      .filter((c) => c.parentId === null)
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  async findSubtree(rootPath: string): Promise<InMemoryCategory[]> {
    const root = this.rows.find((c) => c.path === rootPath);
    if (!root) return [];
    const included = new Set<number>([root.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const row of this.rows) {
        if (
          row.parentId !== null &&
          included.has(row.parentId) &&
          !included.has(row.id)
        ) {
          included.add(row.id);
          changed = true;
        }
      }
    }
    return this.rows
      .filter((c) => included.has(c.id))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  async close(): Promise<void> {}
}

async function buildApp(opts: {
  categories?: InMemoryCategoriesRepository;
} = {}): Promise<{ app: INestApplication }> {
  setEnv({
    NAS_PAIR_PIN: '12345678',
    NAS_PIN_TTL_DAYS: '30',
    NAS_JWT_SECRET: 'test-secret-do-not-use-in-prod-must-be-32+bytes',
    NAS_JWT_TTL_HOURS: '24',
  });
  const devices = new InMemoryDevicesRepository();
  const categories = opts.categories ?? new InMemoryCategoriesRepository();
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(DEVICES_REPOSITORY)
    .useValue(devices)
    .overrideProvider(CATEGORIES_REPOSITORY)
    .useValue(categories)
    .compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(buildValidationPipe());
  await app.init();
  return { app };
}

async function pairAndGetToken(app: INestApplication): Promise<string> {
  const pair = await request(app.getHttpServer())
    .post('/api/auth/pair')
    .send({ pin: '12345678', device_name: 'TestDevice' })
    .expect(201);
  return pair.body.token as string;
}

describe('GET /api/categories (category tree)', () => {
  afterEach(() => {
    restoreEnv();
  });

  it('returns 401 UNAUTHORIZED without a Bearer token', async () => {
    const { app } = await buildApp();
    try {
      await request(app.getHttpServer())
        .get('/api/categories')
        .expect(401);
    } finally {
      await app.close();
    }
  });

  it('returns the seeded top-level categories', async () => {
    const categories = new InMemoryCategoriesRepository();
    await categories.insert({
      path: '/ciencia',
      nameEs: 'Ciencia',
      nameEn: 'Science',
      parentId: null,
      depth: 0,
    });
    await categories.insert({
      path: '/ficcion',
      nameEs: 'Ficción',
      nameEn: 'Fiction',
      parentId: null,
      depth: 0,
    });
    const { app } = await buildApp({ categories });
    try {
      const token = await pairAndGetToken(app);
      const res = await request(app.getHttpServer())
        .get('/api/categories')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      // Returns the root categories, each with its full sub-tree
      // embedded under the ``children`` key.
      expect(res.body.data).toHaveLength(2);
      const paths = res.body.data.map((c: { path: string }) => c.path).sort();
      expect(paths).toEqual(['/ciencia', '/ficcion']);
      const ficcion = res.body.data.find(
        (c: { path: string }) => c.path === '/ficcion',
      );
      expect(ficcion.name_es).toBe('Ficción');
      expect(ficcion.name_en).toBe('Fiction');
      expect(ficcion.children).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('embeds children recursively (root + descendants)', async () => {
    const categories = new InMemoryCategoriesRepository();
    const root = await categories.insert({
      path: '/ciencia',
      nameEs: 'Ciencia',
      nameEn: 'Science',
      parentId: null,
      depth: 0,
    });
    const child = await categories.insert({
      path: '/ciencia/biologia',
      nameEs: 'Biología',
      nameEn: 'Biology',
      parentId: root.id,
      depth: 1,
    });
    await categories.insert({
      path: '/ciencia/biologia/genetica',
      nameEs: 'Genética',
      nameEn: 'Genetics',
      parentId: child.id,
      depth: 2,
    });
    await categories.insert({
      path: '/ficcion',
      nameEs: 'Ficción',
      nameEn: 'Fiction',
      parentId: null,
      depth: 0,
    });

    const { app } = await buildApp({ categories });
    try {
      const token = await pairAndGetToken(app);
      const res = await request(app.getHttpServer())
        .get('/api/categories')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const ciencia = res.body.data.find(
        (c: { path: string }) => c.path === '/ciencia',
      );
      expect(ciencia.children).toHaveLength(1);
      expect(ciencia.children[0].path).toBe('/ciencia/biologia');
      expect(ciencia.children[0].children).toHaveLength(1);
      expect(ciencia.children[0].children[0].path).toBe(
        '/ciencia/biologia/genetica',
      );
    } finally {
      await app.close();
    }
  });
});