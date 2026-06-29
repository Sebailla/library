import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DEVICES_REPOSITORY } from '../src/auth/devices.repository';
import { AUTHORS_REPOSITORY } from '../src/authors/authors.repository';
import { BOOKS_REPOSITORY } from '../src/books/books.repository';
import { buildValidationPipe } from '../src/common/validation.pipe';

/**
 * End-to-end contract tests for the author browsing routes shipped in
 * PR-2D (work unit 2 — authors list + author detail).
 *
 *   GET /api/authors           → 200 {data: AuthorDto[], total: number}
 *   GET /api/authors/:id       → 200 AuthorDetailDto | 404 NOT_FOUND
 *
 * Both routes require a valid Bearer token (PR-2C ``JwtAuthGuard``).
 *
 * The repositories are stubbed in-process so the suite pins the HTTP
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

/* ---------- in-memory repositories ---------- */

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

interface InMemoryAuthor {
  id: number;
  lastname: string;
  firstname: string;
}

class InMemoryAuthorsRepository {
  private rows: InMemoryAuthor[] = [];
  private nextId = 1;

  async insert(a: { lastname: string; firstname: string }): Promise<InMemoryAuthor> {
    const row: InMemoryAuthor = { id: this.nextId++, ...a };
    this.rows.push(row);
    return row;
  }

  async findById(id: number): Promise<InMemoryAuthor | null> {
    return this.rows.find((a) => a.id === id) ?? null;
  }

  async list(opts: { limit?: number; offset?: number } = {}): Promise<InMemoryAuthor[]> {
    const sorted = [...this.rows].sort((a, b) => a.id - b.id);
    const offset = opts.offset ?? 0;
    const limit = opts.limit ?? 20;
    return sorted.slice(offset, offset + limit);
  }

  async count(): Promise<number> {
    return this.rows.length;
  }

  async close(): Promise<void> {}
}

interface InMemoryBook {
  id: number;
  title: string;
  authorId: number | null;
  filePath: string;
}

class InMemoryBooksRepository {
  private rows: InMemoryBook[] = [];
  private nextId = 1;

  async insert(book: { title: string; authorId: number | null; filePath: string }): Promise<InMemoryBook> {
    const row: InMemoryBook = { id: this.nextId++, ...book };
    this.rows.push(row);
    return row;
  }

  async listByAuthor(authorId: number): Promise<InMemoryBook[]> {
    return this.rows.filter((b) => b.authorId === authorId).sort((a, b) => a.id - b.id);
  }

  async findById(id: number): Promise<InMemoryBook | null> {
    return this.rows.find((b) => b.id === id) ?? null;
  }

  async countByLibrary(_libraryId: number): Promise<number> {
    return 0;
  }

  async close(): Promise<void> {}
}

/* ---------- helpers ---------- */

async function buildApp(opts: {
  authors?: InMemoryAuthorsRepository;
  books?: InMemoryBooksRepository;
} = {}): Promise<{
  app: INestApplication;
  authors: InMemoryAuthorsRepository;
  books: InMemoryBooksRepository;
}> {
  setEnv({
    NAS_PAIR_PIN: '12345678',
    NAS_PIN_TTL_DAYS: '30',
    NAS_JWT_SECRET: 'test-secret-do-not-use-in-prod-must-be-32+bytes',
    NAS_JWT_TTL_HOURS: '24',
  });
  const devices = new InMemoryDevicesRepository();
  const authors = opts.authors ?? new InMemoryAuthorsRepository();
  const books = opts.books ?? new InMemoryBooksRepository();
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(DEVICES_REPOSITORY)
    .useValue(devices)
    .overrideProvider(AUTHORS_REPOSITORY)
    .useValue(authors)
    .overrideProvider(BOOKS_REPOSITORY)
    .useValue(books)
    .compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(buildValidationPipe());
  await app.init();
  return { app, authors, books };
}

async function pairAndGetToken(app: INestApplication): Promise<string> {
  const pair = await request(app.getHttpServer())
    .post('/api/auth/pair')
    .send({ pin: '12345678', device_name: 'TestDevice' })
    .expect(201);
  return pair.body.token as string;
}

/* ---------- tests ---------- */

describe('GET /api/authors (author list)', () => {
  afterEach(() => {
    restoreEnv();
  });

  it('returns 401 UNAUTHORIZED without a Bearer token', async () => {
    const { app } = await buildApp();
    try {
      await request(app.getHttpServer())
        .get('/api/authors')
        .expect(401);
    } finally {
      await app.close();
    }
  });

  it('returns paginated list with default page=1, limit=20', async () => {
    const authors = new InMemoryAuthorsRepository();
    for (let i = 0; i < 25; i++) {
      await authors.insert({ lastname: `Author${i}`, firstname: 'X' });
    }
    const { app } = await buildApp({ authors });
    try {
      const token = await pairAndGetToken(app);
      const res = await request(app.getHttpServer())
        .get('/api/authors')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.data).toHaveLength(20);
      expect(res.body.page).toBe(1);
      expect(res.body.limit).toBe(20);
      expect(res.body.total).toBe(25);
      expect(res.body.data[0].lastname).toBe('Author0');
      expect(res.body.data[19].lastname).toBe('Author19');
    } finally {
      await app.close();
    }
  });
});

describe('GET /api/authors/:id (author detail)', () => {
  afterEach(() => {
    restoreEnv();
  });

  it('returns 401 UNAUTHORIZED without a Bearer token', async () => {
    const { app } = await buildApp();
    try {
      await request(app.getHttpServer())
        .get('/api/authors/1')
        .expect(401);
    } finally {
      await app.close();
    }
  });

  it('returns the author with their books', async () => {
    const authors = new InMemoryAuthorsRepository();
    const books = new InMemoryBooksRepository();
    const asimov = await authors.insert({ lastname: 'Asimov', firstname: 'Isaac' });
    await authors.insert({ lastname: 'Le Guin', firstname: 'Ursula' });
    await books.insert({ title: 'Foundation', authorId: asimov.id, filePath: '/lib/f.epub' });
    await books.insert({ title: 'I, Robot', authorId: asimov.id, filePath: '/lib/ir.epub' });
    await books.insert({ title: 'Dispossessed', authorId: null, filePath: '/lib/d.epub' });

    const { app } = await buildApp({ authors, books });
    try {
      const token = await pairAndGetToken(app);
      const res = await request(app.getHttpServer())
        .get(`/api/authors/${asimov.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.id).toBe(asimov.id);
      expect(res.body.lastname).toBe('Asimov');
      expect(res.body.firstname).toBe('Isaac');
      expect(res.body.books).toHaveLength(2);
      const titles = res.body.books.map((b: { title: string }) => b.title).sort();
      expect(titles).toEqual(['Foundation', 'I, Robot']);
    } finally {
      await app.close();
    }
  });

  it('returns 404 NOT_FOUND when the author does not exist', async () => {
    const { app } = await buildApp();
    try {
      const token = await pairAndGetToken(app);
      const res = await request(app.getHttpServer())
        .get('/api/authors/9999')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
      expect(res.body.error).toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      await app.close();
    }
  });
});