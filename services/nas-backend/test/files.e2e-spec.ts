import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { AppModule } from '../src/app.module';
import { DEVICES_REPOSITORY } from '../src/auth/devices.repository';
import { BOOKS_REPOSITORY } from '../src/books/books.repository';
import { CATEGORIES_REPOSITORY } from '../src/books/categories.repository';
import { SAGAS_REPOSITORY } from '../src/books/sagas.repository';
import { FilesService, parseRangeHeader } from '../src/files/files.service';
import { buildValidationPipe } from '../src/common/validation.pipe';

/**
 * End-to-end contract tests for the files module — PR-N1.
 *
 *   GET  /api/files/:book_id   → full body or Range slice
 *   HEAD /api/files/:book_id   → metadata only (Content-Length, Accept-Ranges)
 *
 * The files module reuses the in-memory BooksRepository pattern
 * already established by ``books.e2e-spec.ts``. The FilesService
 * is overridden with a tiny in-memory variant that points at a
 * real temp directory so the fs.createReadStream path actually
 * exercises the real file system. Token protection is verified
 * by relying on the same JwtAuthGuard that already covers the
 * rest of the authenticated surface.
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
    this.rows.push({
      deviceId: row.deviceId,
      deviceName: row.deviceName,
      tokenHash: row.tokenHash,
      pairedAt: new Date(),
      lastSeenAt: null,
      ipAddress: row.ipAddress,
    });
    return { deviceId: row.deviceId, pairedAt: new Date() };
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

interface InMemoryBook {
  id: number;
  title: string;
  authorId: number | null;
  year: number | null;
  language: string | null;
  format: string | null;
  filePath: string;
  fileSizeBytes: number | null;
  contentHash: string | null;
  coverPath: string | null;
  excerpt: string | null;
  indexedAt: Date;
}

class InMemoryBooksRepository {
  private rows: InMemoryBook[] = [];
  private nextId = 1;

  async insert(
    book: Omit<InMemoryBook, 'id' | 'indexedAt'>,
  ): Promise<InMemoryBook> {
    const row: InMemoryBook = {
      id: this.nextId++,
      indexedAt: new Date(),
      ...book,
    };
    this.rows.push(row);
    return row;
  }

  async findById(id: number): Promise<InMemoryBook | null> {
    return this.rows.find((b) => b.id === id) ?? null;
  }

  async list(): Promise<InMemoryBook[]> {
    return [...this.rows];
  }

  async count(): Promise<number> {
    return this.rows.length;
  }

  async search(): Promise<InMemoryBook[]> {
    return [];
  }

  async close(): Promise<void> {}
}

class InMemoryCategoriesRepository {
  async listForBook(): Promise<unknown[]> {
    return [];
  }
  async close(): Promise<void> {}
}

class InMemorySagasRepository {
  async listForBook(): Promise<unknown[]> {
    return [];
  }
  async close(): Promise<void> {}
}

/* ---------- helpers ---------- */

interface TestEnv {
  app: INestApplication;
  libraryRoot: string;
  cleanup: () => void;
  books: InMemoryBooksRepository;
}

async function buildAppWithFile(opts: {
  fileName: string;
  fileContent: string;
  bookOverrides?: Partial<InMemoryBook> & { title: string; filePath: string };
}): Promise<TestEnv> {
  setEnv({
    NAS_PAIR_PIN: '12345678',
    NAS_PIN_TTL_DAYS: '30',
    NAS_JWT_SECRET: 'test-secret-do-not-use-in-prod-must-be-32+bytes',
    NAS_JWT_TTL_HOURS: '24',
  });

  const libraryRoot = mkdtempSync(join(tmpdir(), 'files-e2e-'));
  const filePath = join(libraryRoot, opts.fileName);
  writeFileSync(filePath, opts.fileContent, 'utf8');

  const books = new InMemoryBooksRepository();
  // Persist the stored path RELATIVE to the library root — the
  // service is responsible for resolving it.
  const relative = opts.bookOverrides?.filePath ?? opts.fileName;
  await books.insert({
    title: opts.bookOverrides?.title ?? 'Test Book',
    authorId: opts.bookOverrides?.authorId ?? null,
    year: opts.bookOverrides?.year ?? null,
    language: opts.bookOverrides?.language ?? null,
    format: opts.bookOverrides?.format ?? 'epub',
    filePath: relative,
    fileSizeBytes: opts.bookOverrides?.fileSizeBytes ?? null,
    contentHash: opts.bookOverrides?.contentHash ?? null,
    coverPath: opts.bookOverrides?.coverPath ?? null,
    excerpt: opts.bookOverrides?.excerpt ?? null,
  });

  // FilesService is built manually because the controller wires
  // it via the configured library root. We override the provider
  // so the in-memory instance points at our temp directory.
  const filesService = new FilesService(books as never, libraryRoot);

  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(DEVICES_REPOSITORY)
    .useValue(new InMemoryDevicesRepository())
    .overrideProvider(BOOKS_REPOSITORY)
    .useValue(books)
    .overrideProvider(CATEGORIES_REPOSITORY)
    .useValue(new InMemoryCategoriesRepository())
    .overrideProvider(SAGAS_REPOSITORY)
    .useValue(new InMemorySagasRepository())
    .overrideProvider(FilesService)
    .useValue(filesService)
    .compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(buildValidationPipe());
  await app.init();

  return {
    app,
    libraryRoot,
    books,
    cleanup: () => {
      try {
        rmSync(libraryRoot, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup; the OS reaps tmpdir eventually.
      }
    },
  };
}

async function pairAndGetToken(app: INestApplication): Promise<string> {
  const pair = await request(app.getHttpServer())
    .post('/api/auth/pair')
    .send({ pin: '12345678', device_name: 'TestDevice' })
    .expect(201);
  return pair.body.token as string;
}

/* ---------- tests ---------- */

describe('GET /api/files/:book_id (full body, no Range)', () => {
  afterEach(() => {
    restoreEnv();
  });

  it('returns 401 UNAUTHORIZED without a Bearer token', async () => {
    const env = await buildAppWithFile({
      fileName: 'foundation.epub',
      fileContent: 'binary-content-not-relevant',
    });
    try {
      const res = await request(env.app.getHttpServer())
        .get('/api/files/1')
        .expect(401);
      expect(res.body.error).toMatchObject({ code: 'UNAUTHORIZED' });
    } finally {
      await env.app.close();
      env.cleanup();
    }
  });

  it('returns 404 FILE_NOT_FOUND when the book does not exist', async () => {
    const env = await buildAppWithFile({
      fileName: 'foundation.epub',
      fileContent: 'x',
    });
    try {
      const token = await pairAndGetToken(env.app);
      const res = await request(env.app.getHttpServer())
        .get('/api/files/9999')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
      expect(res.body.error).toMatchObject({ code: 'FILE_NOT_FOUND' });
    } finally {
      await env.app.close();
      env.cleanup();
    }
  });

  it('returns 200 + full body with Content-Type, Content-Length, Accept-Ranges, ETag', async () => {
    const content = 'A'.repeat(4096);
    const env = await buildAppWithFile({
      fileName: 'foundation.epub',
      fileContent: content,
      bookOverrides: {
        title: 'Foundation',
        filePath: 'foundation.epub',
        format: 'epub',
      },
    });
    try {
      const token = await pairAndGetToken(env.app);
      const res = await request(env.app.getHttpServer())
        .get('/api/files/1')
        .set('Authorization', `Bearer ${token}`)
        .buffer(true)
        .parse((response, cb) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () =>
            cb(null, Buffer.concat(chunks).toString('utf8')),
          );
        })
        .expect(200);

      expect(res.headers['content-type']).toMatch(/epub/);
      expect(Number(res.headers['content-length'])).toBe(content.length);
      expect(res.headers['accept-ranges']).toBe('bytes');
      expect(res.headers['etag']).toMatch(/^"[0-9a-f]+-[0-9a-f]+"$/);
      expect(res.body).toBe(content);
    } finally {
      await env.app.close();
      env.cleanup();
    }
  });
});

describe('GET /api/files/:book_id (Range)', () => {
  afterEach(() => {
    restoreEnv();
  });

  it('returns 206 Partial Content with Content-Range for bytes=0-1023', async () => {
    const content = 'B'.repeat(8192);
    const env = await buildAppWithFile({
      fileName: 'big.epub',
      fileContent: content,
    });
    try {
      const token = await pairAndGetToken(env.app);
      const res = await request(env.app.getHttpServer())
        .get('/api/files/1')
        .set('Authorization', `Bearer ${token}`)
        .set('Range', 'bytes=0-1023')
        .buffer(true)
        .parse((response, cb) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () =>
            cb(null, Buffer.concat(chunks).toString('utf8')),
          );
        })
        .expect(206);

      expect(res.headers['content-range']).toBe('bytes 0-1023/8192');
      expect(Number(res.headers['content-length'])).toBe(1024);
      expect(res.body).toBe('B'.repeat(1024));
    } finally {
      await env.app.close();
      env.cleanup();
    }
  });

  it('returns 206 for open-ended bytes=1024- (clamped to EOF)', async () => {
    const content = 'C'.repeat(2048);
    const env = await buildAppWithFile({
      fileName: 'open.epub',
      fileContent: content,
    });
    try {
      const token = await pairAndGetToken(env.app);
      const res = await request(env.app.getHttpServer())
        .get('/api/files/1')
        .set('Authorization', `Bearer ${token}`)
        .set('Range', 'bytes=1024-')
        .buffer(true)
        .parse((response, cb) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () =>
            cb(null, Buffer.concat(chunks).toString('utf8')),
          );
        })
        .expect(206);

      expect(res.headers['content-range']).toBe('bytes 1024-2047/2048');
      expect(Number(res.headers['content-length'])).toBe(1024);
      expect(res.body).toBe('C'.repeat(1024));
    } finally {
      await env.app.close();
      env.cleanup();
    }
  });

  it('returns 416 for an unsatisfiable range (start past EOF)', async () => {
    const env = await buildAppWithFile({
      fileName: 'small.epub',
      fileContent: 'x',
    });
    try {
      const token = await pairAndGetToken(env.app);
      const res = await request(env.app.getHttpServer())
        .get('/api/files/1')
        .set('Authorization', `Bearer ${token}`)
        .set('Range', 'bytes=99999999-')
        .expect(416);
      expect(res.headers['content-range']).toBe('bytes */1');
    } finally {
      await env.app.close();
      env.cleanup();
    }
  });
});

describe('HEAD /api/files/:book_id', () => {
  afterEach(() => {
    restoreEnv();
  });

  it('returns metadata with no body', async () => {
    const content = 'D'.repeat(512);
    const env = await buildAppWithFile({
      fileName: 'meta.epub',
      fileContent: content,
    });
    try {
      const token = await pairAndGetToken(env.app);
      const res = await request(env.app.getHttpServer())
        .head('/api/files/1')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.headers['accept-ranges']).toBe('bytes');
      expect(Number(res.headers['content-length'])).toBe(content.length);
      expect(res.headers['etag']).toMatch(/^"[0-9a-f]+-[0-9a-f]+"$/);
      // HEAD must not have a body.
      expect(res.body).toEqual({});
    } finally {
      await env.app.close();
      env.cleanup();
    }
  });
});

// Suppress an unused-import warning for parseRangeHeader in
// environments where strict unused-imports are enabled.
void parseRangeHeader;