import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DEVICES_REPOSITORY } from '../src/auth/devices.repository';
import { BOOKS_REPOSITORY } from '../src/books/books.repository';
import { CATEGORIES_REPOSITORY } from '../src/books/categories.repository';
import { SAGAS_REPOSITORY } from '../src/books/sagas.repository';
import { buildValidationPipe } from '../src/common/validation.pipe';

/**
 * End-to-end contract tests for the catalog HTTP routes shipped in
 * PR-2D (work unit 1 — books list + book detail).
 *
 *   GET /api/books           → 200 {data: BookDto[], total: number}
 *   GET /api/books/:id       → 200 BookDetailDto | 404 NOT_FOUND
 *
 * All routes require a valid Bearer token (PR-2C ``JwtAuthGuard``).
 *
 * The repositories are stubbed in-process so the suite can pin the
 * HTTP contract without requiring a live Postgres + pgroonga. The
 * real repositories have their own contract tests under
 * ``test/repositories/``.
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
  libraryId: number | null;
  indexedAt: Date;
}

class InMemoryBooksRepository {
  private rows: InMemoryBook[] = [];
  private nextId = 1;

  async insert(book: Omit<InMemoryBook, 'id' | 'indexedAt' | 'libraryId'> & { libraryId?: number | null }): Promise<InMemoryBook> {
    const row: InMemoryBook = {
      id: this.nextId++,
      indexedAt: new Date(),
      libraryId: null,
      ...book,
    };
    this.rows.push(row);
    return row;
  }

  async findById(id: number): Promise<InMemoryBook | null> {
    return this.rows.find((b) => b.id === id) ?? null;
  }

  async list(opts: {
    limit?: number;
    offset?: number;
    authorId?: number;
    format?: string;
    language?: string;
    libraryId?: number;
  } = {}): Promise<InMemoryBook[]> {
    let filtered = this.rows;
    if (opts.authorId !== undefined) {
      filtered = filtered.filter((b) => b.authorId === opts.authorId);
    }
    if (opts.format !== undefined) {
      filtered = filtered.filter((b) => b.format === opts.format);
    }
    if (opts.language !== undefined) {
      filtered = filtered.filter((b) => b.language === opts.language);
    }
    if (opts.libraryId !== undefined) {
      filtered = filtered.filter((b) => b.libraryId === opts.libraryId);
    }
    const sorted = [...filtered].sort((a, b) => a.id - b.id);
    const offset = opts.offset ?? 0;
    const limit = opts.limit ?? 20;
    return sorted.slice(offset, offset + limit);
  }

  async count(filters: {
    authorId?: number;
    format?: string;
    language?: string;
    libraryId?: number;
  } = {}): Promise<number> {
    let filtered = this.rows;
    if (filters.authorId !== undefined) {
      filtered = filtered.filter((b) => b.authorId === filters.authorId);
    }
    if (filters.format !== undefined) {
      filtered = filtered.filter((b) => b.format === filters.format);
    }
    if (filters.language !== undefined) {
      filtered = filtered.filter((b) => b.language === filters.language);
    }
    if (filters.libraryId !== undefined) {
      filtered = filtered.filter((b) => b.libraryId === filters.libraryId);
    }
    return filtered.length;
  }

  async countByLibrary(libraryId: number): Promise<number> {
    return this.rows.filter((b) => b.libraryId === libraryId).length;
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

  async listForBook(bookId: number): Promise<InMemoryCategory[]> {
    // We don't model book_categories here; the controller will call
    // a separate query method. Stub as empty for now.
    return [];
  }

  async close(): Promise<void> {}
}

interface InMemorySaga {
  id: number;
  name: string;
  authorId: number | null;
}

class InMemorySagasRepository {
  private rows: InMemorySaga[] = [];
  private nextId = 1;

  async insert(s: Omit<InMemorySaga, 'id'>): Promise<InMemorySaga> {
    const row: InMemorySaga = { id: this.nextId++, ...s };
    this.rows.push(row);
    return row;
  }

  async listForBook(bookId: number): Promise<InMemorySaga[]> {
    return [];
  }

  async close(): Promise<void> {}
}

/* ---------- helpers ---------- */

async function buildApp(opts: {
  books?: InMemoryBooksRepository;
  categories?: InMemoryCategoriesRepository;
  sagas?: InMemorySagasRepository;
} = {}): Promise<{
  app: INestApplication;
  books: InMemoryBooksRepository;
}> {
  setEnv({
    NAS_PAIR_PIN: '12345678',
    NAS_PIN_TTL_DAYS: '30',
    NAS_JWT_SECRET: 'test-secret-do-not-use-in-prod-must-be-32+bytes',
    NAS_JWT_TTL_HOURS: '24',
  });
  const devices = new InMemoryDevicesRepository();
  const books = opts.books ?? new InMemoryBooksRepository();
  const categories = opts.categories ?? new InMemoryCategoriesRepository();
  const sagas = opts.sagas ?? new InMemorySagasRepository();
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
    .compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(buildValidationPipe());
  await app.init();
  return { app, books };
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

describe('GET /api/books (catalog list)', () => {
  afterEach(() => {
    restoreEnv();
  });

  it('returns 401 UNAUTHORIZED without a Bearer token', async () => {
    const { app } = await buildApp();
    try {
      const res = await request(app.getHttpServer())
        .get('/api/books')
        .expect(401);
      expect(res.body.error).toMatchObject({ code: 'UNAUTHORIZED' });
    } finally {
      await app.close();
    }
  });

  it('returns paginated list with default page=1, limit=20', async () => {
    const books = new InMemoryBooksRepository();
    for (let i = 0; i < 25; i++) {
      await seedBook(books, {
        title: `Book ${i}`,
        filePath: `/lib/book-${i}.epub`,
      });
    }
    const { app } = await buildApp({ books });
    try {
      const token = await pairAndGetToken(app);
      const res = await request(app.getHttpServer())
        .get('/api/books')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.data).toHaveLength(20);
      expect(res.body.page).toBe(1);
      expect(res.body.limit).toBe(20);
      expect(res.body.total).toBe(25);
      // First 20 by id ASC.
      expect(res.body.data[0].title).toBe('Book 0');
      expect(res.body.data[19].title).toBe('Book 19');
    } finally {
      await app.close();
    }
  });

  it('honours ?page and ?limit query params', async () => {
    const books = new InMemoryBooksRepository();
    for (let i = 0; i < 25; i++) {
      await seedBook(books, {
        title: `Book ${i}`,
        filePath: `/lib/book-${i}.epub`,
      });
    }
    const { app } = await buildApp({ books });
    try {
      const token = await pairAndGetToken(app);
      const res = await request(app.getHttpServer())
        .get('/api/books?page=2&limit=10')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.data).toHaveLength(10);
      expect(res.body.page).toBe(2);
      expect(res.body.limit).toBe(10);
      expect(res.body.data[0].title).toBe('Book 10');
      expect(res.body.data[9].title).toBe('Book 19');
    } finally {
      await app.close();
    }
  });

  it('filters by ?author_id, ?format, ?language', async () => {
    const books = new InMemoryBooksRepository();
    await seedBook(books, {
      title: 'Foundation',
      filePath: '/lib/foundation.epub',
      format: 'epub',
      language: 'en',
      authorId: 1,
    });
    await seedBook(books, {
      title: 'Dune',
      filePath: '/lib/dune.epub',
      format: 'epub',
      language: 'en',
      authorId: 2,
    });
    await seedBook(books, {
      title: 'Solaris',
      filePath: '/lib/solaris.pdf',
      format: 'pdf',
      language: 'en',
      authorId: 2,
    });
    await seedBook(books, {
      title: 'El amor en los tiempos del cólera',
      filePath: '/lib/amor.epub',
      format: 'epub',
      language: 'es',
      authorId: 3,
    });
    const { app } = await buildApp({ books });
    try {
      const token = await pairAndGetToken(app);

      const byAuthor = await request(app.getHttpServer())
        .get('/api/books?author_id=2')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(byAuthor.body.total).toBe(2);
      const titles = byAuthor.body.data.map((b: { title: string }) => b.title);
      expect(titles.sort()).toEqual(['Dune', 'Solaris']);

      const byFormat = await request(app.getHttpServer())
        .get('/api/books?format=epub')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(byFormat.body.total).toBe(3);

      const byLanguage = await request(app.getHttpServer())
        .get('/api/books?language=es')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(byLanguage.body.total).toBe(1);
      expect(byLanguage.body.data[0].title).toBe(
        'El amor en los tiempos del cólera',
      );
    } finally {
      await app.close();
    }
  });
});

describe('GET /api/books/:id (book detail)', () => {
  afterEach(() => {
    restoreEnv();
  });

  it('returns 401 UNAUTHORIZED without a Bearer token', async () => {
    const { app } = await buildApp();
    try {
      await request(app.getHttpServer())
        .get('/api/books/1')
        .expect(401);
    } finally {
      await app.close();
    }
  });

  it('returns the book with author and category placeholders', async () => {
    const books = new InMemoryBooksRepository();
    const inserted = await seedBook(books, {
      title: 'Foundation',
      filePath: '/lib/foundation.epub',
      authorId: 1,
      format: 'epub',
      language: 'en',
      year: 1951,
      excerpt: 'The psychohistorian Hari Seldon…',
    });
    const { app } = await buildApp({ books });
    try {
      const token = await pairAndGetToken(app);
      const res = await request(app.getHttpServer())
        .get(`/api/books/${inserted.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.id).toBe(inserted.id);
      expect(res.body.title).toBe('Foundation');
      expect(res.body.author_id).toBe(1);
      expect(res.body.format).toBe('epub');
      expect(res.body.language).toBe('en');
      expect(res.body.year).toBe(1951);
      // Empty arrays for now — populated by follow-up work units.
      expect(res.body.categories).toEqual([]);
      expect(res.body.sagas).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('returns 404 NOT_FOUND when the book does not exist', async () => {
    const { app } = await buildApp();
    try {
      const token = await pairAndGetToken(app);
      const res = await request(app.getHttpServer())
        .get('/api/books/9999')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
      expect(res.body.error).toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      await app.close();
    }
  });
});