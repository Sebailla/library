import {
  BooksRepository,
  createBooksRepository,
  NewBook,
} from '../../src/repositories/books.repository';
import {
  DATABASE_URL,
  insertAuthor,
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
});