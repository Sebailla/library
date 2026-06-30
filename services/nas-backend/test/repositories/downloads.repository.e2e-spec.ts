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

  /**
   * PR-N3 — top devices for a book.
   *
   * Powers ``GET /api/downloads/by-book/:book_id`` (admin-only).
   * The contract: group every download of the given book by
   * ``device_id``, count them, find the latest ``downloaded_at``
   * for the (book, device) pair, order by count DESC then
   * ``device_id`` ASC for ties, and cap at ``limit`` rows.
   */
  it('topDevicesForBook returns the top N devices for a given book, ordered by count DESC', async () => {
    const authorId = await insertAuthor('Borges', 'Jorge Luis');
    const book = await books.insert({
      title: 'Ficciones',
      authorId,
      filePath: '/library/borges/ficciones.epub',
      fileSizeBytes: 100,
      contentHash: 'h',
    });
    const deviceA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const deviceB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const deviceC = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

    // 3 downloads for deviceA, 2 for deviceB, 1 for deviceC.
    for (let i = 0; i < 3; i++) {
      await repo.insert({
        bookId: book.id,
        deviceId: deviceA,
        deviceName: 'A',
        fileSizeBytes: 100,
      });
    }
    for (let i = 0; i < 2; i++) {
      await repo.insert({
        bookId: book.id,
        deviceId: deviceB,
        deviceName: 'B',
        fileSizeBytes: 100,
      });
    }
    await repo.insert({
      bookId: book.id,
      deviceId: deviceC,
      deviceName: 'C',
      fileSizeBytes: 100,
    });

    const top = await repo.topDevicesForBook(book.id, 10);
    expect(top).toHaveLength(3);
    expect(top[0]?.deviceId).toBe(deviceA);
    expect(top[0]?.count).toBe(3);
    expect(top[0]?.deviceName).toBe('A');
    expect(top[1]?.deviceId).toBe(deviceB);
    expect(top[1]?.count).toBe(2);
    expect(top[2]?.deviceId).toBe(deviceC);
    expect(top[2]?.count).toBe(1);
    // last_downloaded_at is a Date, populated from the most
    // recent row per (book, device) pair.
    for (const row of top) {
      expect(row.lastDownloadedAt).toBeInstanceOf(Date);
    }
  });

  it('topDevicesForBook honours the limit and excludes NULL device_id rows', async () => {
    const authorId = await insertAuthor('Cortazar', 'Julio');
    const book = await books.insert({
      title: 'Rayuela',
      authorId,
      filePath: '/library/cortazar/rayuela.epub',
      fileSizeBytes: 100,
      contentHash: 'h',
    });
    const deviceA = '11111111-1111-1111-1111-111111111111';
    const deviceB = '22222222-2222-2222-2222-222222222222';

    // Insert two downloads from real devices + one with no
    // device_id (legacy rows from before 4R #42). The legacy
    // rows MUST be excluded from the top-devices count because
    // they have no ``device_id`` to attribute to.
    await repo.insert({
      bookId: book.id,
      deviceId: deviceA,
      fileSizeBytes: 100,
    });
    await repo.insert({
      bookId: book.id,
      deviceId: deviceB,
      fileSizeBytes: 100,
    });
    await repo.insert({
      bookId: book.id,
      deviceId: null,
      deviceName: 'Legacy',
      fileSizeBytes: 100,
    });

    const top = await repo.topDevicesForBook(book.id, 1);
    // Limit clamps to 1 even though 2 devices have downloaded.
    expect(top).toHaveLength(1);
    // Order is non-deterministic on ties, so just assert the
    // count value is 1 and the device is one of the real two.
    expect(top[0]?.count).toBe(1);
    expect([deviceA, deviceB]).toContain(top[0]?.deviceId);
  });

  it('topDevicesForBook returns an empty list when no rows match the book', async () => {
    const top = await repo.topDevicesForBook(999_999, 10);
    expect(top).toEqual([]);
  });

  /**
   * PR-N3 — ``listForDevice`` is the privacy-scoped alternative to
   * ``listByDevice``. The wire shape is identical, but the
   * semantic is "the bearer's own downloads filtered server-side
   * by ``req.device.deviceId``" rather than "the bearer's own
   * downloads filtered by a path param the caller passes in".
   *
   * The repository-level method is intentionally the same shape
   * as ``listByDevice`` so the service layer can shape the wire
   * envelope without a second query path.
   */
  it('listForDevice returns every download for a given device, newest first', async () => {
    const authorId = await insertAuthor('Asimov', 'Isaac');
    const book = await books.insert({
      title: 'Foundation',
      authorId,
      filePath: '/library/asimov/foundation.epub',
      fileSizeBytes: 100,
      contentHash: 'h',
    });
    const deviceA = '55555555-5555-5555-5555-555555555555';
    const deviceB = '66666666-6666-6666-6666-666666666666';

    const dlA1 = await repo.insert({
      bookId: book.id,
      deviceId: deviceA,
      fileSizeBytes: 100,
    });
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

    const list = await repo.listForDevice(deviceA);
    expect(list).toHaveLength(2);
    expect(list.map((d) => d.id)).toEqual([dlA2.id, dlA1.id]);
  });

  it('listForDevice honours the limit option', async () => {
    const authorId = await insertAuthor('Asimov', 'Isaac');
    const book = await books.insert({
      title: 'Foundation',
      authorId,
      filePath: '/library/asimov/foundation.epub',
      fileSizeBytes: 100,
      contentHash: 'h',
    });
    const device = '77777777-7777-7777-7777-777777777777';
    for (let i = 0; i < 5; i++) {
      await repo.insert({
        bookId: book.id,
        deviceId: device,
        fileSizeBytes: 100,
      });
    }
    const list = await repo.listForDevice(device, { limit: 3 });
    expect(list).toHaveLength(3);
  });

  /**
   * PR-N3 — ``findByBookId`` returns every download for a given
   * book, newest first. The method backs any future
   * ``GET /api/downloads/by-book/:book_id/all`` listing endpoint
   * and is exercised by the admin tooling so a per-book activity
   * log can be rendered.
   */
  it('findByBookId returns every download for a given book, newest first', async () => {
    const authorId = await insertAuthor('Borges', 'Jorge Luis');
    const bookA = await books.insert({
      title: 'Ficciones',
      authorId,
      filePath: '/library/borges/ficciones.epub',
      fileSizeBytes: 100,
      contentHash: 'h',
    });
    const bookB = await books.insert({
      title: 'El Aleph',
      authorId,
      filePath: '/library/borges/aleph.epub',
      fileSizeBytes: 100,
      contentHash: 'h2',
    });
    const deviceA = '88888888-8888-8888-8888-888888888888';
    const deviceB = '99999999-9999-9999-9999-999999999999';

    const dl1 = await repo.insert({
      bookId: bookA.id,
      deviceId: deviceA,
      fileSizeBytes: 100,
    });
    const dl2 = await repo.insert({
      bookId: bookA.id,
      deviceId: deviceB,
      fileSizeBytes: 100,
    });
    await repo.insert({
      bookId: bookB.id,
      deviceId: deviceA,
      fileSizeBytes: 100,
    });

    const list = await repo.findByBookId(bookA.id);
    expect(list).toHaveLength(2);
    expect(list.map((d) => d.id)).toEqual([dl2.id, dl1.id]);
  });
});