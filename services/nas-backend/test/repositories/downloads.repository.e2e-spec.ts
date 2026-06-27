import {
  DownloadsRepository,
  createDownloadsRepository,
} from '../../src/repositories/downloads.repository';
import { createBooksRepository } from '../../src/repositories/books.repository';
import { DATABASE_URL, insertAuthor, resetAndMigrate } from './_fixtures';

/**
 * Contract tests for ``DownloadsRepository``.
 *
 * Every download is recorded with the device id so per-device
 * history can be queried; ``markCompleted`` flips the flag once the
 * file is fully streamed.
 */

const hasDb = !!process.env.DATABASE_URL;
const describeDb = hasDb ? describe : describe.skip;

describeDb('DownloadsRepository', () => {
  const repo: DownloadsRepository = createDownloadsRepository({
    connectionString: DATABASE_URL,
  });
  const books = createBooksRepository({ connectionString: DATABASE_URL });

  beforeEach(async () => {
    await resetAndMigrate(__dirname);
  });

  afterAll(async () => {
    await repo.close();
    await books.close();
  });

  it('inserts a download with completed = false by default', async () => {
    const authorId = await insertAuthor('Asimov', 'Isaac');
    const book = await books.insert({
      title: 'Foundation',
      authorId,
      filePath: '/library/asimov/foundation.epub',
      fileSizeBytes: 1024,
      contentHash: 'h',
    });
    const deviceId = '11111111-1111-1111-1111-111111111111';
    const inserted = await repo.insert({
      bookId: book.id,
      deviceId,
      deviceName: 'iPad de Seba',
      fileSizeBytes: 1024,
      ipAddress: '192.168.1.42',
      userAgent: 'alejandria/1.0',
    });
    expect(inserted.id).toBeGreaterThan(0);
    expect(inserted.completed).toBe(false);
    expect(inserted.deviceId).toBe(deviceId);
    expect(inserted.downloadedAt).toBeInstanceOf(Date);
  });

  it('markCompleted flips the flag and records the byte count', async () => {
    const authorId = await insertAuthor('Asimov', 'Isaac');
    const book = await books.insert({
      title: 'Foundation',
      authorId,
      filePath: '/library/asimov/foundation.epub',
      fileSizeBytes: 2048,
      contentHash: 'h',
    });
    const deviceId = '22222222-2222-2222-2222-222222222222';
    const dl = await repo.insert({
      bookId: book.id,
      deviceId,
      fileSizeBytes: 2048,
    });
    await repo.markCompleted(dl.id, 2048);

    const detail = await repo.findById(dl.id);
    expect(detail?.completed).toBe(true);
    expect(detail?.bytesTransferred).toBe(2048);
  });

  it('listByDevice returns every download for a given device, newest first', async () => {
    const authorId = await insertAuthor('Asimov', 'Isaac');
    const book = await books.insert({
      title: 'Foundation',
      authorId,
      filePath: '/library/asimov/foundation.epub',
      fileSizeBytes: 100,
      contentHash: 'h',
    });
    const deviceA = '33333333-3333-3333-3333-333333333333';
    const deviceB = '44444444-4444-4444-4444-444444444444';

    const dlA1 = await repo.insert({
      bookId: book.id,
      deviceId: deviceA,
      fileSizeBytes: 100,
    });
    // Force a measurable ordering gap by inserting with an explicit
    // older timestamp via a separate ``insertAt`` helper if needed.
    const dlA2 = await repo.insert({
      bookId: book.id,
      deviceId: deviceA,
      fileSizeBytes: 100,
    });
    await repo.insert({
      bookId: book.id,
      deviceId: deviceB,
      fileSizeBytes: 100,
    });

    const listA = await repo.listByDevice(deviceA);
    expect(listA).toHaveLength(2);
    expect(listA.map((d) => d.id)).toEqual([dlA2.id, dlA1.id]);

    const listB = await repo.listByDevice(deviceB);
    expect(listB).toHaveLength(1);
    expect(listB[0].deviceId).toBe(deviceB);
  });

  it('findById returns null when no such download exists', async () => {
    const found = await repo.findById(999_999);
    expect(found).toBeNull();
  });
});