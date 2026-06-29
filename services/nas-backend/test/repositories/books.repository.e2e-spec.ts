import {
  BooksRepository,
  createBooksRepository,
  NewBook,
} from '../../src/repositories/books.repository';
import {
  DATABASE_URL,
  insertAuthor,
  insertLibrary,
  resetAndMigrate,
} from './_fixtures';

/**
 * Contract tests for ``BooksRepository``.
 *
 * The repository is exercised against a real Postgres database. The
 * public schema is dropped + recreated (via the migration runner)
 * before every test so each case starts from a known state.
 */

const hasDb = !!process.env.DATABASE_URL;
const describeDb = hasDb ? describe : describe.skip;

describeDb('BooksRepository', () => {
  const repo: BooksRepository = createBooksRepository({ connectionString: DATABASE_URL });

  beforeEach(async () => {
    await resetAndMigrate(__dirname);
  });

  afterAll(async () => {
    await repo.close();
  });

  it('inserts a book and returns it via findById', async () => {
    const authorId = await insertAuthor('Asimov', 'Isaac');
    const newBook: NewBook = {
      title: 'Foundation',
      authorId,
      year: 1951,
      language: 'en',
      format: 'epub',
      filePath: '/library/asimov/foundation.epub',
      fileSizeBytes: 1024,
      contentHash: 'hash-asimov-foundation',
      coverPath: '/covers/foundation.webp',
      excerpt: 'The psychohistorian Hari Seldon…',
    };
    const inserted = await repo.insert(newBook);
    expect(inserted.id).toBeGreaterThan(0);
    expect(inserted.title).toBe('Foundation');
    expect(inserted.authorId).toBe(authorId);
    expect(inserted.filePath).toBe('/library/asimov/foundation.epub');
    expect(inserted.indexedAt).toBeInstanceOf(Date);

    const found = await repo.findById(inserted.id);
    expect(found).not.toBeNull();
    expect(found?.title).toBe('Foundation');
    expect(found?.authorId).toBe(authorId);
    expect(found?.contentHash).toBe('hash-asimov-foundation');
  });

  it('returns null from findById when no such book exists', async () => {
    const found = await repo.findById(9_999_999);
    expect(found).toBeNull();
  });

  it('lists books filtered by author id', async () => {
    const asimov = await insertAuthor('Asimov', 'Isaac');
    const leguin = await insertAuthor('Le Guin', 'Ursula');
    await repo.insert({
      title: 'Foundation',
      authorId: asimov,
      filePath: '/library/asimov/foundation.epub',
      fileSizeBytes: 100,
      contentHash: 'h1',
    });
    await repo.insert({
      title: 'I, Robot',
      authorId: asimov,
      filePath: '/library/asimov/i-robot.epub',
      fileSizeBytes: 100,
      contentHash: 'h2',
    });
    await repo.insert({
      title: 'The Left Hand of Darkness',
      authorId: leguin,
      filePath: '/library/leguin/lhod.epub',
      fileSizeBytes: 100,
      contentHash: 'h3',
    });

    const asimovBooks = await repo.listByAuthor(asimov);
    expect(asimovBooks).toHaveLength(2);
    const titles = asimovBooks.map((b) => b.title).sort();
    expect(titles).toEqual(['Foundation', 'I, Robot']);

    const leguinBooks = await repo.listByAuthor(leguin);
    expect(leguinBooks).toHaveLength(1);
    expect(leguinBooks[0].title).toBe('The Left Hand of Darkness');
  });

  it('list respects pagination (limit + offset)', async () => {
    const authorId = await insertAuthor('Author', 'A');
    // Insert 5 books.
    for (let i = 0; i < 5; i++) {
      await repo.insert({
        title: `Book ${i}`,
        authorId,
        filePath: `/library/a/book-${i}.epub`,
        fileSizeBytes: 10,
        contentHash: `hash-${i}`,
      });
    }
    const page1 = await repo.list({ limit: 2, offset: 0 });
    const page2 = await repo.list({ limit: 2, offset: 2 });
    const page3 = await repo.list({ limit: 2, offset: 4 });
    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(2);
    expect(page3).toHaveLength(1);

    // No overlap between pages.
    const ids = [...page1, ...page2, ...page3].map((b) => b.id);
    expect(new Set(ids).size).toBe(5);
  });

  it('list returns books ordered by id ASC by default', async () => {
    const authorId = await insertAuthor('Author', 'B');
    for (let i = 0; i < 3; i++) {
      await repo.insert({
        title: `Book ${i}`,
        authorId,
        filePath: `/library/b/book-${i}.epub`,
        fileSizeBytes: 10,
        contentHash: `h-${i}`,
      });
    }
    const all = await repo.list();
    expect(all).toHaveLength(3);
    for (let i = 1; i < all.length; i++) {
      expect(all[i].id).toBeGreaterThan(all[i - 1].id);
    }
  });

  // PR-N2 — list / count accept an optional ``libraryId`` filter
  // so the per-library browse view stays cheap as the catalog
  // grows. The books.repository contract widens to expose the
  // filter; the new field is optional so existing callers
  // continue to work unchanged.
  it('list filters by libraryId when supplied', async () => {
    const authorId = await insertAuthor('Author', 'C');
    const libA = await insertLibrary('A');
    const libB = await insertLibrary('B');
    // Three books: two belong to libA, one to libB. The
    // repository cannot insert library_id yet (the column is
    // set via a follow-up UPDATE so the test pins the filter
    // behaviour, not the insert surface).
    const a1 = await repo.insert({
      title: 'A-1',
      authorId,
      filePath: '/library/a-1.epub',
      fileSizeBytes: 10,
      contentHash: 'a-1',
    });
    const a2 = await repo.insert({
      title: 'A-2',
      authorId,
      filePath: '/library/a-2.epub',
      fileSizeBytes: 10,
      contentHash: 'a-2',
    });
    const b1 = await repo.insert({
      title: 'B-1',
      authorId,
      filePath: '/library/b-1.epub',
      fileSizeBytes: 10,
      contentHash: 'b-1',
    });
    // Stamp the books with their library_id via the underlying
    // SQL so the filter test exercises the WHERE clause and
    // not the insert surface.
    const { withClient } = await import('./_fixtures');
    await withClient(async (client) => {
      await client.query('UPDATE books SET library_id = $1 WHERE id = $2', [
        libA,
        a1.id,
      ]);
      await client.query('UPDATE books SET library_id = $1 WHERE id = $2', [
        libA,
        a2.id,
      ]);
      await client.query('UPDATE books SET library_id = $1 WHERE id = $2', [
        libB,
        b1.id,
      ]);
    });

    const onlyA = await repo.list({ libraryId: libA });
    expect(onlyA).toHaveLength(2);
    const onlyB = await repo.list({ libraryId: libB });
    expect(onlyB).toHaveLength(1);
    expect(onlyB[0]?.title).toBe('B-1');

    // No filter: every book still surfaces.
    const all = await repo.list();
    expect(all).toHaveLength(3);
  });

  it('count filters by libraryId when supplied', async () => {
    const authorId = await insertAuthor('Author', 'D');
    const libA = await insertLibrary('A-2');
    const libB = await insertLibrary('B-2');
    for (const [i, title] of [0, 1, 2].entries()) {
      await repo.insert({
        title: `D-${title ?? i}`,
        authorId,
        filePath: `/library/d-${title ?? i}.epub`,
        fileSizeBytes: 10,
        contentHash: `d-${title ?? i}`,
      });
    }
    const { withClient } = await import('./_fixtures');
    await withClient(async (client) => {
      await client.query(
        'UPDATE books SET library_id = $1 WHERE id IN (SELECT id FROM books ORDER BY id ASC LIMIT 2)',
        [libA],
      );
      await client.query(
        'UPDATE books SET library_id = $1 WHERE id IN (SELECT id FROM books ORDER BY id DESC LIMIT 1)',
        [libB],
      );
    });

    expect(await repo.count({ libraryId: libA })).toBe(2);
    expect(await repo.count({ libraryId: libB })).toBe(1);
    // No filter: every book is counted.
    expect(await repo.count()).toBe(3);
  });

  it('search uses pgroonga to find books by title fragment', async () => {
    const authorId = await insertAuthor('García', 'Márquez');
    await repo.insert({
      title: 'Cien años de soledad',
      authorId,
      filePath: '/library/garcia/cien-anios.epub',
      fileSizeBytes: 100,
      contentHash: 'soledad',
      excerpt: 'Muchos años después…',
    });
    await repo.insert({
      title: 'El amor en los tiempos del cólera',
      authorId,
      filePath: '/library/garcia/amor.epub',
      fileSizeBytes: 100,
      contentHash: 'colera',
    });
    await repo.insert({
      title: 'La hojarasca',
      authorId,
      filePath: '/library/garcia/hojarasca.epub',
      fileSizeBytes: 100,
      contentHash: 'hojarasca',
    });
    const hits = await repo.search('soledad');
    expect(hits).toHaveLength(1);
    expect(hits[0].title).toBe('Cien años de soledad');
  });
});