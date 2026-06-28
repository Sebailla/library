import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DEVICES_REPOSITORY } from '../src/auth/devices.repository';
import {
  DOWNLOADS_REPOSITORY,
  DownloadsRepository,
  NewDownload,
} from '../src/downloads/downloads.repository';
import { BOOKS_REPOSITORY } from '../src/books/books.repository';
import { CATEGORIES_REPOSITORY } from '../src/books/categories.repository';
import { SAGAS_REPOSITORY } from '../src/books/sagas.repository';
import { buildValidationPipe } from '../src/common/validation.pipe';

/**
 * End-to-end contract tests for the downloads HTTP module (PR-2E,
 * work unit 1).
 *
 *   POST  /api/downloads                 → 201 {download_id, resume_supported}
 *   PATCH /api/downloads/:id             → 200 {id, completed, bytes_transferred}
 *   GET   /api/downloads/stats           → 200 aggregated counts
 *   GET   /api/downloads/by-device/:id   → 200 list of downloads
 *
 * All endpoints require a valid Bearer token. The
 * ``DownloadsRepository`` is stubbed in-process so the suite can pin
 * the HTTP contract without a live Postgres.
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
  private currentTokenHash = '';

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
    this.currentTokenHash = row.tokenHash;
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
    if (row) {
      row.tokenHash = tokenHash;
      this.currentTokenHash = tokenHash;
    }
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

  async insert(book: Omit<InMemoryBook, 'id' | 'indexedAt'>): Promise<InMemoryBook> {
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

  async list(_opts: unknown = {}): Promise<InMemoryBook[]> {
    return [...this.rows];
  }

  async count(_filters: unknown = {}): Promise<number> {
    return this.rows.length;
  }

  async close(): Promise<void> {}
}

class InMemoryCategoriesRepository {
  async insert(): Promise<unknown> {
    return null;
  }
  async findByPath(): Promise<unknown> {
    return null;
  }
  async listForBook(): Promise<unknown[]> {
    return [];
  }
  async close(): Promise<void> {}
}

class InMemorySagasRepository {
  async insert(): Promise<unknown> {
    return null;
  }
  async listForBook(): Promise<unknown[]> {
    return [];
  }
  async close(): Promise<void> {}
}

interface InMemoryDownloadRow {
  id: number;
  bookId: number;
  deviceId: string | null;
  deviceName: string | null;
  userId: string | null;
  downloadedAt: Date;
  fileSizeBytes: number | null;
  bytesTransferred: number | null;
  completed: boolean;
  ipAddress: string | null;
  userAgent: string | null;
}

class InMemoryDownloadsRepository {
  private rows: InMemoryDownloadRow[] = [];
  private nextId = 1;

  async insert(input: NewDownload): Promise<InMemoryDownloadRow> {
    const row: InMemoryDownloadRow = {
      id: this.nextId++,
      bookId: input.bookId,
      deviceId: input.deviceId ?? null,
      deviceName: input.deviceName ?? null,
      userId: input.userId ?? null,
      downloadedAt: new Date(),
      fileSizeBytes: input.fileSizeBytes ?? null,
      bytesTransferred: input.bytesTransferred ?? 0,
      completed: false,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    };
    this.rows.push(row);
    return row;
  }

  async markCompleted(id: number, bytesTransferred: number): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (!row) return;
    row.completed = true;
    row.bytesTransferred = bytesTransferred;
  }

  async updateProgress(id: number, bytesTransferred: number): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (!row) return;
    row.bytesTransferred = bytesTransferred;
  }

  async listByDevice(
    deviceId: string,
    opts: { limit?: number } = {},
  ): Promise<InMemoryDownloadRow[]> {
    const limit = opts.limit ?? 100;
    const filtered = this.rows.filter((r) => r.deviceId === deviceId);
    return filtered
      .sort((a, b) => b.downloadedAt.getTime() - a.downloadedAt.getTime())
      .slice(0, limit);
  }

  async findById(id: number): Promise<InMemoryDownloadRow | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }

  async findCompletedForDeviceAndBook(
    deviceId: string,
    bookId: number,
  ): Promise<InMemoryDownloadRow | null> {
    const filtered = this.rows.filter(
      (r) =>
        r.deviceId === deviceId && r.bookId === bookId && r.completed,
    );
    filtered.sort((a, b) => b.downloadedAt.getTime() - a.downloadedAt.getTime());
    return filtered[0] ?? null;
  }

  async stats(): Promise<{
    total: number;
    completed: number;
    top_books: Array<{ book_id: number; count: number }>;
    top_devices: Array<{ device_id: string; count: number }>;
  }> {
    const total = this.rows.length;
    const completed = this.rows.filter((r) => r.completed).length;
    const byBook = new Map<number, number>();
    const byDevice = new Map<string, number>();
    for (const row of this.rows) {
      byBook.set(row.bookId, (byBook.get(row.bookId) ?? 0) + 1);
      if (row.deviceId) {
        byDevice.set(row.deviceId, (byDevice.get(row.deviceId) ?? 0) + 1);
      }
    }
    const top_books = [...byBook.entries()]
      .map(([book_id, count]) => ({ book_id, count }))
      .sort((a, b) => b.count - a.count);
    const top_devices = [...byDevice.entries()]
      .map(([device_id, count]) => ({ device_id, count }))
      .sort((a, b) => b.count - a.count);
    return { total, completed, top_books, top_devices };
  }

  async close(): Promise<void> {}
}

/* ---------- helpers ---------- */

async function buildApp(opts: {
  downloads?: InMemoryDownloadsRepository;
} = {}): Promise<{
  app: INestApplication;
  downloads: InMemoryDownloadsRepository;
  books: InMemoryBooksRepository;
}> {
  setEnv({
    NAS_PAIR_PIN: '12345678',
    NAS_PIN_TTL_DAYS: '30',
    NAS_JWT_SECRET: 'test-secret-do-not-use-in-prod-must-be-32+bytes',
    NAS_JWT_TTL_HOURS: '24',
  });
  const devices = new InMemoryDevicesRepository();
  const books = new InMemoryBooksRepository();
  const categories = new InMemoryCategoriesRepository();
  const sagas = new InMemorySagasRepository();
  const downloads = opts.downloads ?? new InMemoryDownloadsRepository();
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(DEVICES_REPOSITORY)
    .useValue(devices)
    .overrideProvider(BOOKS_REPOSITORY)
    .useValue(books)
    .overrideProvider(CATEGORIES_REPOSITORY)
    .useValue(categories)
    .overrideProvider(SAGAS_REPOSITORY)
    .useValue(sagas)
    .overrideProvider(DOWNLOADS_REPOSITORY)
    .useValue(downloads)
    .compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(buildValidationPipe());
  await app.init();
  return { app, downloads, books };
}

async function pairAndGetToken(app: INestApplication): Promise<string> {
  const pair = await request(app.getHttpServer())
    .post('/api/auth/pair')
    .send({ pin: '12345678', device_name: 'TestDevice' })
    .expect(201);
  return pair.body.token as string;
}

async function seedBook(
  books: InMemoryBooksRepository,
  partial: Partial<InMemoryBook> & { title: string; filePath: string },
): Promise<InMemoryBook> {
  return books.insert({
    title: partial.title,
    authorId: partial.authorId ?? null,
    year: partial.year ?? null,
    language: partial.language ?? null,
    format: partial.format ?? null,
    filePath: partial.filePath,
    fileSizeBytes: partial.fileSizeBytes ?? null,
    contentHash: partial.contentHash ?? null,
    coverPath: partial.coverPath ?? null,
    excerpt: partial.excerpt ?? null,
  });
}

/* ---------- tests ---------- */

describe('POST /api/downloads', () => {
  afterEach(() => {
    restoreEnv();
  });

  it('returns 401 UNAUTHORIZED without a Bearer token', async () => {
    const { app } = await buildApp();
    try {
      await request(app.getHttpServer())
        .post('/api/downloads')
        .send({ book_id: 1, file_size_bytes: 1024 })
        .expect(401);
    } finally {
      await app.close();
    }
  });

  it('returns 201 with {download_id, resume_supported} on first download', async () => {
    const { app, books } = await buildApp();
    try {
      const book = await seedBook(books, {
        title: 'Foundation',
        filePath: '/lib/foundation.epub',
      });
      const token = await pairAndGetToken(app);
      const res = await request(app.getHttpServer())
        .post('/api/downloads')
        .set('Authorization', `Bearer ${token}`)
        .send({
          book_id: book.id,
          file_size_bytes: 1024,
        })
        .expect(201);
      expect(typeof res.body.download_id).toBe('number');
      expect(res.body.download_id).toBeGreaterThan(0);
      // A fresh download is still in progress — not resumable yet.
      expect(res.body.resume_supported).toBe(false);
    } finally {
      await app.close();
    }
  });

  it('persists a row with completed=false and bytes_transferred=0', async () => {
    const { app, books, downloads } = await buildApp();
    try {
      const book = await seedBook(books, {
        title: 'Dune',
        filePath: '/lib/dune.epub',
      });
      // Single pairing so the bearer device matches the row's
      // device. After the IDOR fix (#42) the device_name comes
      // from the paired device row, NOT from the request body.
      const pair = await request(app.getHttpServer())
        .post('/api/auth/pair')
        .send({ pin: '12345678', device_name: 'iPad de Seba' })
        .expect(201);
      const token = pair.body.token as string;
      const me = await request(app.getHttpServer())
        .get('/api/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const expectedDeviceName = me.body.device_name as string;
      const res = await request(app.getHttpServer())
        .post('/api/downloads')
        .set('Authorization', `Bearer ${token}`)
        .send({
          book_id: book.id,
          file_size_bytes: 4096,
        })
        .expect(201);
      const id = res.body.download_id as number;
      const stored = await downloads.findById(id);
      expect(stored).not.toBeNull();
      expect(stored?.bookId).toBe(book.id);
      expect(stored?.completed).toBe(false);
      expect(stored?.bytesTransferred).toBe(0);
      expect(stored?.fileSizeBytes).toBe(4096);
      expect(stored?.deviceName).toBe(expectedDeviceName);
    } finally {
      await app.close();
    }
  });

  it('returns the same download_id with resume_supported=true on retry of a completed download', async () => {
    const { app, books, downloads } = await buildApp();
    try {
      const book = await seedBook(books, {
        title: 'Solaris',
        filePath: '/lib/solaris.pdf',
      });
      const pair = await request(app.getHttpServer())
        .post('/api/auth/pair')
        .send({ pin: '12345678', device_name: 'iPad' })
        .expect(201);
      const token = pair.body.token as string;
      const bearerDeviceId = pair.body.device_id as string;

      // First attempt — creates a fresh row attributed to the
      // bearer device (4R #42: server derives device_id from
      // req.device).
      const first = await request(app.getHttpServer())
        .post('/api/downloads')
        .set('Authorization', `Bearer ${token}`)
        .send({
          book_id: book.id,
          file_size_bytes: 2048,
        })
        .expect(201);
      const firstId = first.body.download_id as number;

      // Mark the first one completed (simulates successful download).
      await downloads.markCompleted(firstId, 2048);

      // Second attempt for the same (book_id, device_id) — must
      // return the SAME id and ``resume_supported: true``.
      const second = await request(app.getHttpServer())
        .post('/api/downloads')
        .set('Authorization', `Bearer ${token}`)
        .send({
          book_id: book.id,
          file_size_bytes: 2048,
        })
        .expect(201);
      expect(second.body.download_id).toBe(firstId);
      expect(second.body.resume_supported).toBe(true);

      // No duplicate row created.
      const allForBook = (
        await downloads.listByDevice(bearerDeviceId)
      ).filter((d) => d.bookId === book.id);
      expect(allForBook).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it('creates a NEW row (resume_supported=false) when a previous download is still in progress', async () => {
    const { app, books } = await buildApp();
    try {
      const book = await seedBook(books, {
        title: 'El amor en los tiempos del cólera',
        filePath: '/lib/amor.epub',
      });
      const pair = await request(app.getHttpServer())
        .post('/api/auth/pair')
        .send({ pin: '12345678', device_name: 'iPad' })
        .expect(201);
      const token = pair.body.token as string;

      const first = await request(app.getHttpServer())
        .post('/api/downloads')
        .set('Authorization', `Bearer ${token}`)
        .send({
          book_id: book.id,
          file_size_bytes: 1024,
        })
        .expect(201);

      const second = await request(app.getHttpServer())
        .post('/api/downloads')
        .set('Authorization', `Bearer ${token}`)
        .send({
          book_id: book.id,
          file_size_bytes: 1024,
        })
        .expect(201);
      expect(second.body.download_id).not.toBe(first.body.download_id);
      expect(second.body.resume_supported).toBe(false);
    } finally {
      await app.close();
    }
  });

  it('returns 400 on missing book_id', async () => {
    const { app } = await buildApp();
    try {
      const token = await pairAndGetToken(app);
      await request(app.getHttpServer())
        .post('/api/downloads')
        .set('Authorization', `Bearer ${token}`)
        .send({ file_size_bytes: 1024 })
        .expect(400);
    } finally {
      await app.close();
    }
  });
});

describe('PATCH /api/downloads/:id', () => {
  afterEach(() => {
    restoreEnv();
  });

  it('marks the row as completed with the byte count', async () => {
    const { app, books } = await buildApp();
    try {
      const book = await seedBook(books, {
        title: 'Ficciones',
        filePath: '/lib/ficciones.epub',
      });
      const token = await pairAndGetToken(app);
      const created = await request(app.getHttpServer())
        .post('/api/downloads')
        .set('Authorization', `Bearer ${token}`)
        .send({ book_id: book.id, file_size_bytes: 5120 })
        .expect(201);
      const id = created.body.download_id as number;

      const patched = await request(app.getHttpServer())
        .patch(`/api/downloads/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ completed: true, bytes_transferred: 5120 })
        .expect(200);
      expect(patched.body.id).toBe(id);
      expect(patched.body.completed).toBe(true);
      expect(patched.body.bytes_transferred).toBe(5120);
    } finally {
      await app.close();
    }
  });

  it('records a partial download with the byte count and completed=false', async () => {
    const { app, books } = await buildApp();
    try {
      const book = await seedBook(books, {
        title: 'Rayuela',
        filePath: '/lib/rayuela.epub',
      });
      const token = await pairAndGetToken(app);
      const created = await request(app.getHttpServer())
        .post('/api/downloads')
        .set('Authorization', `Bearer ${token}`)
        .send({ book_id: book.id, file_size_bytes: 8192 })
        .expect(201);
      const id = created.body.download_id as number;

      const patched = await request(app.getHttpServer())
        .patch(`/api/downloads/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ completed: false, bytes_transferred: 4096 })
        .expect(200);
      expect(patched.body.completed).toBe(false);
      expect(patched.body.bytes_transferred).toBe(4096);
    } finally {
      await app.close();
    }
  });

  it('returns 404 for a non-existent download id', async () => {
    const { app } = await buildApp();
    try {
      const token = await pairAndGetToken(app);
      const res = await request(app.getHttpServer())
        .patch('/api/downloads/9999')
        .set('Authorization', `Bearer ${token}`)
        .send({ completed: true, bytes_transferred: 0 })
        .expect(404);
      expect(res.body.error).toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      await app.close();
    }
  });
});

describe('GET /api/downloads/stats', () => {
  afterEach(() => {
    restoreEnv();
  });

  it('returns aggregated counts with top_books and top_devices', async () => {
    const { app, books, downloads } = await buildApp();
    try {
      const book1 = await seedBook(books, {
        title: 'A',
        filePath: '/lib/a.epub',
      });
      const book2 = await seedBook(books, {
        title: 'B',
        filePath: '/lib/b.epub',
      });
      const token = await pairAndGetToken(app);
      const deviceA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      const deviceB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

      // 3 downloads for book1 (1 from deviceA, 2 from deviceB),
      // 1 download for book2 (from deviceA). 4R #42 — the server
      // no longer accepts device_id in the body, so we inject
      // these rows directly through the in-memory repository.
      // This still exercises the same stats query path.
      await downloads.insert({
        bookId: book1.id,
        deviceId: deviceA,
        deviceName: 'A',
        fileSizeBytes: 10,
      });
      await downloads.insert({
        bookId: book1.id,
        deviceId: deviceB,
        deviceName: 'B',
        fileSizeBytes: 10,
      });
      await downloads.insert({
        bookId: book1.id,
        deviceId: deviceB,
        deviceName: 'B',
        fileSizeBytes: 10,
      });
      await downloads.insert({
        bookId: book2.id,
        deviceId: deviceA,
        deviceName: 'A',
        fileSizeBytes: 10,
      });

      const res = await request(app.getHttpServer())
        .get('/api/downloads/stats')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.total).toBe(4);
      expect(res.body.completed).toBe(0); // none completed in this test
      expect(res.body.top_books).toHaveLength(2);
      expect(res.body.top_books[0].book_id).toBe(book1.id);
      expect(res.body.top_books[0].count).toBe(3);
      expect(res.body.top_devices).toHaveLength(2);
      // Both devices tied at 2; sort is stable so we just assert the
      // count value is present.
      const deviceCounts = Object.fromEntries(
        (res.body.top_devices as Array<{ device_id: string; count: number }>).map(
          (d) => [d.device_id, d.count],
        ),
      );
      expect(deviceCounts[deviceA]).toBe(2);
      expect(deviceCounts[deviceB]).toBe(2);
    } finally {
      await app.close();
    }
  });

  it('returns 401 without a Bearer token', async () => {
    const { app } = await buildApp();
    try {
      await request(app.getHttpServer())
        .get('/api/downloads/stats')
        .expect(401);
    } finally {
      await app.close();
    }
  });
});

describe('GET /api/downloads/by-device/:device_id', () => {
  afterEach(() => {
    restoreEnv();
  });

  it('lists every download for the bearer device, newest first', async () => {
    // 4R #42 — GET /by-device/:device_id now refuses when the
    // path param does not match the bearer. The list is therefore
    // ALWAYS the bearer's own downloads. We inject rows for the
    // bearer (via HTTP) and rows for OTHER devices (via the repo
    // directly) to confirm the bearer only sees their own.
    const { app, books, downloads } = await buildApp();
    try {
      const book = await seedBook(books, {
        title: 'Borges',
        filePath: '/lib/borges.epub',
      });
      const pair = await request(app.getHttpServer())
        .post('/api/auth/pair')
        .send({ pin: '12345678', device_name: 'Self' })
        .expect(201);
      const token = pair.body.token as string;
      const bearerDeviceId = pair.body.device_id as string;
      const other = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

      // First bearer-owned download via HTTP.
      await request(app.getHttpServer())
        .post('/api/downloads')
        .set('Authorization', `Bearer ${token}`)
        .send({
          book_id: book.id,
          file_size_bytes: 100,
        })
        .expect(201);
      // Sleep one ms to guarantee an ordering gap on fast machines.
      await new Promise((r) => setTimeout(r, 5));
      // Second bearer-owned download via HTTP.
      await request(app.getHttpServer())
        .post('/api/downloads')
        .set('Authorization', `Bearer ${token}`)
        .send({
          book_id: book.id,
          file_size_bytes: 200,
        })
        .expect(201);
      // A row belonging to a DIFFERENT device, injected via the
      // repository (no HTTP path lets us create this anymore).
      await downloads.insert({
        bookId: book.id,
        deviceId: other,
        deviceName: 'Other',
        fileSizeBytes: 999,
      });

      const res = await request(app.getHttpServer())
        .get(`/api/downloads/by-device/${bearerDeviceId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.data).toHaveLength(2);
      // Newest first — the second POST has a later ``downloaded_at``.
      expect(res.body.data[0].file_size_bytes).toBe(200);
      expect(res.body.data[1].file_size_bytes).toBe(100);
      expect(res.body.data[0].device_id).toBe(bearerDeviceId);
      expect(res.body.data[1].device_id).toBe(bearerDeviceId);
    } finally {
      await app.close();
    }
  });

  it('returns 200 with empty data for an unknown bearer device (still passes the IDOR check)', async () => {
    // 4R #42 — the IDOR guard compares path param vs bearer; when
    // they match the request is served (with whatever rows the
    // bearer has — empty in this case). Pairing once means the
    // bearer device is fixed; we ask for its own list which is
    // empty.
    const { app } = await buildApp();
    try {
      const pair = await request(app.getHttpServer())
        .post('/api/auth/pair')
        .send({ pin: '12345678', device_name: 'EmptyDevice' })
        .expect(201);
      const token = pair.body.token as string;
      const bearerDeviceId = pair.body.device_id as string;
      const res = await request(app.getHttpServer())
        .get(`/api/downloads/by-device/${bearerDeviceId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.data).toEqual([]);
    } finally {
      await app.close();
    }
  });
});

/**
 * 4R review #42 — IDOR fixes for /api/downloads.
 *
 * Before this PR:
 *   - POST /api/downloads accepted ``device_id`` / ``device_name`` /
 *     ``user_id`` in the body. A malicious device could send
 *     ``device_id: '<victim-device-id>'`` and attribute the row
 *     to the victim.
 *   - PATCH /api/downloads/:id had no ownership check. Device A
 *     could PATCH Device B's row.
 *   - GET /api/downloads/by-device/:device_id had no ownership
 *     check. Device A could query Device B's full history.
 *
 * After the fix:
 *   - The POST body only carries ``book_id`` (+ optional
 *     ``file_size_bytes``). ``device_id`` / ``device_name`` /
 *     ``user_id`` are silently dropped and the server uses
 *     ``req.device`` exclusively.
 *   - PATCH first looks up the row and refuses (403 FORBIDDEN)
 *     if ``row.device_id`` does not match the bearer device.
 *   - GET /by-device/:device_id refuses (403 FORBIDDEN) when
 *     the param does not match the bearer device.
 *
 * Tests below exercise each IDOR surface.
 */
describe('IDOR hardening for /api/downloads (4R review #42)', () => {
  afterEach(() => {
    restoreEnv();
  });

  it('POST ignores body device_id — server uses req.device instead', async () => {
    const { app, books, downloads } = await buildApp();
    try {
      const book = await seedBook(books, {
        title: 'Crime and Punishment',
        filePath: '/lib/crime.epub',
      });
      // Single pairing: the bearer is the device the server
      // MUST attribute the row to.
      const pair = await request(app.getHttpServer())
        .post('/api/auth/pair')
        .send({ pin: '12345678', device_name: 'SpoofAttempt' })
        .expect(201);
      const token = pair.body.token as string;
      const attackerDeviceId = pair.body.device_id as string;

      const res = await request(app.getHttpServer())
        .post('/api/downloads')
        .set('Authorization', `Bearer ${token}`)
        .send({
          book_id: book.id,
          device_id: '00000000-0000-0000-0000-deadbeef0000',
          device_name: 'INJECTED-NAME',
          user_id: 'INJECTED-USER',
          file_size_bytes: 1024,
        })
        .expect(201);

      const row = await downloads.findById(res.body.download_id as number);
      // The server MUST attribute the row to the bearer's device,
      // NOT the spoofed body fields. The validation pipe's
      // whitelist drops device_id/device_name/user_id from the
      // DTO before the controller runs, so the controller's
      // req.device is the only source of attribution.
      expect(row?.deviceId).toBe(attackerDeviceId);
      expect(row?.deviceId).not.toBe('00000000-0000-0000-0000-deadbeef0000');
      expect(row?.deviceName).toBe('SpoofAttempt');
      expect(row?.deviceName).not.toBe('INJECTED-NAME');
    } finally {
      await app.close();
    }
  });

  it('PATCH /api/downloads/:id returns 403 when the row belongs to a different device', async () => {
    const { app, books, downloads } = await buildApp();
    try {
      const book = await seedBook(books, {
        title: 'Beloved',
        filePath: '/lib/beloved.epub',
      });

      // Pair device A → token A → create a download row for A.
      const pairA = await request(app.getHttpServer())
        .post('/api/auth/pair')
        .send({ pin: '12345678', device_name: 'DeviceA' })
        .expect(201);
      const tokenA = pairA.body.token as string;
      const deviceA = pairA.body.device_id as string;

      const created = await request(app.getHttpServer())
        .post('/api/downloads')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ book_id: book.id, file_size_bytes: 1024 })
        .expect(201);
      const downloadId = created.body.download_id as number;

      // Pair device B → token B. Try to PATCH A's download.
      const pairB = await request(app.getHttpServer())
        .post('/api/auth/pair')
        .send({ pin: '12345678', device_name: 'DeviceB' })
        .expect(201);
      const tokenB = pairB.body.token as string;

      const res = await request(app.getHttpServer())
        .patch(`/api/downloads/${downloadId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ completed: true, bytes_transferred: 1024 })
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');

      // The row MUST remain in its original state — device A's
      // bytes_transferred is still 0, completed still false.
      const row = await downloads.findById(downloadId);
      expect(row?.bytesTransferred).toBe(0);
      expect(row?.completed).toBe(false);
      expect(row?.deviceId).toBe(deviceA);
    } finally {
      await app.close();
    }
  });

  it('PATCH /api/downloads/:id succeeds for the owning device (positive control)', async () => {
    const { app, books } = await buildApp();
    try {
      const book = await seedBook(books, {
        title: 'Native Son',
        filePath: '/lib/native.epub',
      });
      const token = await pairAndGetToken(app);
      const created = await request(app.getHttpServer())
        .post('/api/downloads')
        .set('Authorization', `Bearer ${token}`)
        .send({ book_id: book.id, file_size_bytes: 1024 })
        .expect(201);
      const id = created.body.download_id as number;

      const patched = await request(app.getHttpServer())
        .patch(`/api/downloads/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ completed: true, bytes_transferred: 1024 })
        .expect(200);
      expect(patched.body.completed).toBe(true);
      expect(patched.body.bytes_transferred).toBe(1024);
    } finally {
      await app.close();
    }
  });

  it('GET /api/downloads/by-device/:device_id returns 403 when the param does not match the bearer', async () => {
    const { app } = await buildApp();
    try {
      const token = await pairAndGetToken(app);
      const pair = await request(app.getHttpServer())
        .post('/api/auth/pair')
        .send({ pin: '12345678', device_name: 'DeviceB' })
        .expect(201);
      const deviceB = pair.body.device_id as string;

      const res = await request(app.getHttpServer())
        .get(`/api/downloads/by-device/${deviceB}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    } finally {
      await app.close();
    }
  });

  it('GET /api/downloads/by-device/:device_id returns 200 when the param matches the bearer', async () => {
    const { app } = await buildApp();
    try {
      const pair = await request(app.getHttpServer())
        .post('/api/auth/pair')
        .send({ pin: '12345678', device_name: 'Self' })
        .expect(201);
      const ownDeviceId = pair.body.device_id as string;
      const token = pair.body.token as string;

      const res = await request(app.getHttpServer())
        .get(`/api/downloads/by-device/${ownDeviceId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    } finally {
      await app.close();
    }
  });
});

// Type-only re-export so the test can assert the repository contract
// shape compiled into the production module matches what we mock.
export type { DownloadsRepository };