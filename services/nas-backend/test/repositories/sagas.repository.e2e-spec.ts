import {
  SagasRepository,
  createSagasRepository,
} from '../../src/repositories/sagas.repository';
import {
  createBooksRepository,
  NewBook,
} from '../../src/repositories/books.repository';
import { DATABASE_URL, insertAuthor, resetAndMigrate } from './_fixtures';

/**
 * Contract tests for ``SagasRepository``.
 *
 * The sagas repo attaches a book to a saga (``attachBook``) and
 * returns every saga a given author has written via
 * ``listByAuthor``. The author and book fixtures are inserted
 * directly through ``authors`` and ``books`` so the test does not
 * depend on the books repository's ``insert`` method.
 */

const hasDb = !!process.env.DATABASE_URL;
const describeDb = hasDb ? describe : describe.skip;

describeDb('SagasRepository', () => {
  const repo: SagasRepository = createSagasRepository({
    connectionString: DATABASE_URL,
  });
  // We use the books repo just for fixtures because the contract for
  // inserting books is already covered by its own test suite.
  const books = createBooksRepository({ connectionString: DATABASE_URL });

  beforeEach(async () => {
    await resetAndMigrate(__dirname);
  });

  afterAll(async () => {
    await repo.close();
    await books.close();
  });

  it('inserts a saga and finds it by id', async () => {
    const authorId = await insertAuthor('Asimov', 'Isaac');
    const saga = await repo.insert({ name: 'Foundation', authorId });
    expect(saga.id).toBeGreaterThan(0);
    expect(saga.name).toBe('Foundation');
    expect(saga.authorId).toBe(authorId);
  });

  it('attaches a book to a saga and lists sagas by author', async () => {
    const authorId = await insertAuthor('Asimov', 'Isaac');
    const otherAuthor = await insertAuthor('Le Guin', 'Ursula');
    const saga = await repo.insert({ name: 'Foundation', authorId });
    const otherSaga = await repo.insert({
      name: 'Earthsea',
      authorId: otherAuthor,
    });

    const newBook: NewBook = {
      title: 'Foundation',
      authorId,
      filePath: '/library/asimov/foundation.epub',
      fileSizeBytes: 1024,
      contentHash: 'hash-foundation',
    };
    const insertedBook = await books.insert(newBook);

    await repo.attachBook({
      bookId: insertedBook.id,
      sagaId: saga.id,
      ordinal: 1,
    });

    const asimovSagas = await repo.listByAuthor(authorId);
    expect(asimovSagas).toHaveLength(1);
    expect(asimovSagas[0].id).toBe(saga.id);
    expect(asimovSagas[0].name).toBe('Foundation');

    // Other author's saga must not be returned.
    const leguinSagas = await repo.listByAuthor(otherAuthor);
    expect(leguinSagas).toHaveLength(1);
    expect(leguinSagas[0].id).toBe(otherSaga.id);
  });

  it('returns multiple sagas for an author with books attached', async () => {
    const authorId = await insertAuthor('Asimov', 'Isaac');
    const foundation = await repo.insert({ name: 'Foundation', authorId });
    const robots = await repo.insert({ name: 'Robot', authorId });
    const bookA = await books.insert({
      title: 'Foundation',
      authorId,
      filePath: '/library/asimov/foundation.epub',
      fileSizeBytes: 100,
      contentHash: 'h1',
    });
    const bookB = await books.insert({
      title: 'I, Robot',
      authorId,
      filePath: '/library/asimov/i-robot.epub',
      fileSizeBytes: 100,
      contentHash: 'h2',
    });
    await repo.attachBook({ bookId: bookA.id, sagaId: foundation.id });
    await repo.attachBook({ bookId: bookB.id, sagaId: robots.id });

    const sagas = await repo.listByAuthor(authorId);
    expect(sagas).toHaveLength(2);
    const names = sagas.map((s) => s.name).sort();
    expect(names).toEqual(['Foundation', 'Robot']);
  });

  it('attachBook is idempotent — re-attaching the same book does not duplicate', async () => {
    const authorId = await insertAuthor('Asimov', 'Isaac');
    const saga = await repo.insert({ name: 'Foundation', authorId });
    const book = await books.insert({
      title: 'Foundation',
      authorId,
      filePath: '/library/asimov/foundation.epub',
      fileSizeBytes: 100,
      contentHash: 'h',
    });
    await repo.attachBook({ bookId: book.id, sagaId: saga.id, ordinal: 1 });
    // Second call MUST NOT throw. The PRIMARY KEY (book_id, saga_id)
    // on book_sagas enforces uniqueness; the repository uses an
    // upsert (ON CONFLICT DO NOTHING).
    await repo.attachBook({ bookId: book.id, sagaId: saga.id, ordinal: 1 });

    const sagas = await repo.listByAuthor(authorId);
    expect(sagas).toHaveLength(1);
    const detail = await repo.listBooksInSaga(saga.id);
    expect(detail).toHaveLength(1);
    expect(detail[0].bookId).toBe(book.id);
  });
});