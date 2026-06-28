import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
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
    NAS_PAIR_PIN: '0000',
    NAS_PIN_TTL_DAYS: '30',
    NAS_JWT_SECRET: 'test-secret-do-not-use-in-prod',
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
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return { app, downloads, books };
}

async function pairAndGetToken(app: INestApplication): Promise<string> {
  const pair = await request(app.getHttpServer())
    .post('/api/auth/pair')
    .send({ pin: '0000', device_name: 'TestDevice' })
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
          device_name: 'iPad de Seba',
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
      const token = await pairAndGetToken(app);
      const res = await request(app.getHttpServer())
        .post('/api/downloads')
        .set('Authorization', `Bearer ${token}`)
        .send({
          book_id: book.id,
          device_name: 'iPad',
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
      expect(stored?.deviceName).toBe('iPad');
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
      const token = await pairAndGetToken(app);
      const deviceId = '11111111-1111-1111-1111-111111111111';

      // First attempt — creates a fresh row.
      const first = await request(app.getHttpServer())
        .post('/api/downloads')
        .set('Authorization', `Bearer ${token}`)
        .send({
          book_id: book.id,
          device_id: deviceId,
          device_name: 'iPad',
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
          device_id: deviceId,
          device_name: 'iPad',
          file_size_bytes: 2048,
        })
        .expect(201);
      expect(second.body.download_id).toBe(firstId);
      expect(second.body.resume_supported).toBe(true);

      // No duplicate row created.
      const allForBook = (await downloads.listByDevice(deviceId)).filter(
        (d) => d.bookId === book.id,
      );
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
      const token = await pairAndGetToken(app);
      const deviceId = '22222222-2222-2222-2222-222222222222';

      const first = await request(app.getHttpServer())
        .post('/api/downloads')
        .set('Authorization', `Bearer ${token}`)
        .send({
          book_id: book.id,
          device_id: deviceId,
          device_name: 'iPad',
          file_size_bytes: 1024,
        })
        .expect(201);

      const second = await request(app.getHttpServer())
        .post('/api/downloads')
        .set('Authorization', `Bearer ${token}`)
        .send({
          book_id: book.id,
          device_id: deviceId,
          device_name: 'iPad',
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
    const { app, books } = await buildApp();
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
      // 1 download for book2 (from deviceA).
      await request(app.getHttpServer())
        .post('/api/downloads')
        .set('Authorization', `Bearer ${token}`)
        .send({
          book_id: book1.id,
          device_id: deviceA,
          device_name: 'A',
          file_size_bytes: 10,
        })
        .expect(201);
      await request(app.getHttpServer())
        .post('/api/downloads')
        .set('Authorization', `Bearer ${token}`)
        .send({
          book_id: book1.id,
          device_id: deviceB,
          device_name: 'B',
          file_size_bytes: 10,
        })
        .expect(201);
      await request(app.getHttpServer())
        .post('/api/downloads')
        .set('Authorization', `Bearer ${token}`)
        .send({
          book_id: book1.id,
          device_id: deviceB,
          device_name: 'B',
          file_size_bytes: 10,
        })
        .expect(201);
      await request(app.getHttpServer())
        .post('/api/downloads')
        .set('Authorization', `Bearer ${token}`)
        .send({
          book_id: book2.id,
          device_id: deviceA,
          device_name: 'A',
          file_size_bytes: 10,
        })
        .expect(201);

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

  it('lists every download for the given device, newest first', async () => {
    const { app, books } = await buildApp();
    try {
      const book = await seedBook(books, {
        title: 'Borges',
        filePath: '/lib/borges.epub',
      });
      const token = await pairAndGetToken(app);
      const target = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
      const other = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

      await request(app.getHttpServer())
        .post('/api/downloads')
        .set('Authorization', `Bearer ${token}`)
        .send({
          book_id: book.id,
          device_id: target,
          device_name: 'iPad',
          file_size_bytes: 100,
        })
        .expect(201);
      // Sleep one ms to guarantee an ordering gap on fast machines.
      await new Promise((r) => setTimeout(r, 5));
      await request(app.getHttpServer())
        .post('/api/downloads')
        .set('Authorization', `Bearer ${token}`)
        .send({
          book_id: book.id,
          device_id: target,
          device_name: 'iPad',
          file_size_bytes: 200,
        })
        .expect(201);
      await request(app.getHttpServer())
        .post('/api/downloads')
        .set('Authorization', `Bearer ${token}`)
        .send({
          book_id: book.id,
          device_id: other,
          device_name: 'Other',
          file_size_bytes: 999,
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/api/downloads/by-device/${target}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.data).toHaveLength(2);
      // Newest first — the second POST has a later ``downloaded_at``.
      expect(res.body.data[0].file_size_bytes).toBe(200);
      expect(res.body.data[1].file_size_bytes).toBe(100);
      expect(res.body.data[0].device_id).toBe(target);
      expect(res.body.data[1].device_id).toBe(target);
    } finally {
      await app.close();
    }
  });

  it('returns 200 with empty data for an unknown device', async () => {
    const { app } = await buildApp();
    try {
      const token = await pairAndGetToken(app);
      const res = await request(app.getHttpServer())
        .get('/api/downloads/by-device/eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.data).toEqual([]);
    } finally {
      await app.close();
    }
  });
});

// Type-only re-export so the test can assert the repository contract
// shape compiled into the production module matches what we mock.
export type { DownloadsRepository };