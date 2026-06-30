import {
  ScanJob,
  ScanJobKind,
  ScanJobStatus,
} from '../../../src/admin/scan/scan.types';
import {
  ScanRepository,
  createScanRepository,
} from '../../../src/admin/scan/scan.repository';
import {
  DATABASE_URL,
  insertLibrary,
  resetAndMigrate,
} from '../../repositories/_fixtures';

/**
 * Contract tests for {@link ScanRepository} (PR-N4).
 *
 * The repository is the data-access layer for the admin scan
 * ``scan_jobs`` table. The contract covers:
 *
 *   - ``insertJob``        — record a queued scan request.
 *   - ``getJob``           — read a single job by UUID pk.
 *   - ``listJobs``         — newest-first history for the admin
 *                            status endpoint.
 *   - ``setJobStatus``     — flip ``status`` + ``started_at`` /
 *                            ``finished_at`` for state transitions.
 *   - ``updateProgress``   — increment ``processed_files`` between
 *                            files (the SSE tick source).
 *   - ``requestCancellation`` / ``isCancelled`` — cooperative
 *                            cancel primitives. The controller flips
 *                            the flag via ``requestCancellation``;
 *                            the worker reads it between files via
 *                            ``isCancelled``.
 */

const hasDb = !!process.env.DATABASE_URL;
const describeDb = hasDb ? describe : describe.skip;

describeDb('ScanRepository', () => {
  let repo: ScanRepository;

  beforeEach(async () => {
    await resetAndMigrate(__dirname);
    repo = createScanRepository({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    await repo.close();
  });

  it('insertJob + getJob round-trips a queued scan with processed_files = 0', async () => {
    const libraryId = await insertLibrary('Borges');
    const id = '11111111-1111-1111-1111-111111111111';
    const inserted = await repo.insertJob({
      id,
      libraryId,
      kind: 'full',
    });
    expect(inserted.id).toBe(id);
    expect(inserted.libraryId).toBe(libraryId);
    expect(inserted.kind).toBe<ScanJobKind>('full');
    expect(inserted.status).toBe<ScanJobStatus>('queued');
    expect(inserted.processedFiles).toBe(0);
    expect(inserted.startedAt).toBeNull();
    expect(inserted.finishedAt).toBeNull();
    expect(inserted.totalFiles).toBeNull();
    expect(inserted.cancelled).toBe(false);
    expect(inserted.error).toBeNull();

    const fetched: ScanJob | null = await repo.getJob(id);
    expect(fetched).not.toBeNull();
    expect(fetched).toEqual(inserted);
  });

  it('insertJob accepts a null library_id (whole-NAS scan variant)', async () => {
    const id = '22222222-2222-2222-2222-222222222222';
    const inserted = await repo.insertJob({
      id,
      libraryId: null,
      kind: 'incremental',
    });
    expect(inserted.libraryId).toBeNull();
    expect(inserted.kind).toBe<ScanJobKind>('incremental');
  });

  it('insertJob rejects a kind outside the CHECK constraint', async () => {
    // Pass the type checker via cast — the CHECK constraint is the
    // last line of defence. The promise MUST reject so a typo in
    // a future caller cannot smuggle a row through.
    await expect(
      repo.insertJob({
        id: '33333333-3333-3333-3333-333333333333',
        libraryId: null,
        kind: 'bogus' as ScanJobKind,
      }),
    ).rejects.toThrow();
  });

  it('getJob returns null for an unknown UUID', async () => {
    expect(await repo.getJob('99999999-9999-9999-9999-999999999999')).toBeNull();
  });

  it('setJobStatus transitions queued → running with started_at populated', async () => {
    const libraryId = await insertLibrary('Biología');
    const id = '44444444-4444-4444-4444-444444444444';
    await repo.insertJob({ id, libraryId, kind: 'full' });

    const updated = await repo.setJobStatus(id, 'running');
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe<ScanJobStatus>('running');
    expect(updated!.startedAt).toBeInstanceOf(Date);
    // ``finished_at`` MUST remain null while running.
    expect(updated!.finishedAt).toBeNull();
  });

  it('setJobStatus to a terminal state populates finished_at', async () => {
    const libraryId = await insertLibrary('Química');
    const id = '55555555-5555-5555-5555-555555555555';
    await repo.insertJob({ id, libraryId, kind: 'incremental' });
    await repo.setJobStatus(id, 'running');

    const updated = await repo.setJobStatus(id, 'done');
    expect(updated!.status).toBe<ScanJobStatus>('done');
    expect(updated!.finishedAt).toBeInstanceOf(Date);
  });

  it('updateProgress increments processed_files and records the latest total_files', async () => {
    const libraryId = await insertLibrary('Historia');
    const id = '66666666-6666-6666-6666-666666666666';
    await repo.insertJob({ id, libraryId, kind: 'full' });
    await repo.setJobStatus(id, 'running');

    await repo.updateProgress(id, 1, 50);
    let row = await repo.getJob(id);
    expect(row!.processedFiles).toBe(1);
    expect(row!.totalFiles).toBe(50);

    await repo.updateProgress(id, 25, 50);
    row = await repo.getJob(id);
    expect(row!.processedFiles).toBe(25);
    expect(row!.totalFiles).toBe(50);
  });

  it('requestCancellation flips the cancelled flag (status untouched)', async () => {
    const libraryId = await insertLibrary('Arte');
    const id = '77777777-7777-7777-7777-777777777777';
    await repo.insertJob({ id, libraryId, kind: 'full' });
    await repo.setJobStatus(id, 'running');

    expect(await repo.isCancelled(id)).toBe(false);
    await repo.requestCancellation(id);
    expect(await repo.isCancelled(id)).toBe(true);

    // Status MUST still be running — the worker will observe
    // the flag, finish the current file, then transition to
    // ``cancelled`` itself.
    const row = await repo.getJob(id);
    expect(row!.status).toBe<ScanJobStatus>('running');
  });

  it('isCancelled returns false for an unknown UUID (not true)', async () => {
    // Defensive: an unknown job MUST report ``false`` so a worker
    // that checks the flag on a not-yet-persisted id (race) does
    // not bail out.
    expect(await repo.isCancelled('00000000-0000-0000-0000-000000000000')).toBe(false);
  });

  it('listJobs returns every job, newest first', async () => {
    const libraryId = await insertLibrary('Filosofía');
    const a = await repo.insertJob({
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      libraryId,
      kind: 'full',
    });
    const b = await repo.insertJob({
      id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      libraryId,
      kind: 'incremental',
    });
    const list = await repo.listJobs();
    expect(list).toHaveLength(2);
    // Newest first by started_at DESC NULLS LAST, falling back to
    // id ASC for ties; both rows have null started_at, so id ASC
    // breaks the tie in reverse insertion order — ``b`` was
    // inserted after ``a`` so it appears first.
    expect(list.map((j) => j.id)).toEqual([b.id, a.id]);
  });
});