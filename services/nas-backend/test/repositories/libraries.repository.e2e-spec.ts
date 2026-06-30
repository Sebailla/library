import {
  createLibrariesRepository,
  LibrariesRepository,
} from '../../src/libraries/libraries.repository';
import {
  DATABASE_URL,
  resetAndMigrate,
} from './_fixtures';

/**
 * Contract tests for ``LibrariesRepository``.
 *
 * The repository is exercised against a real Postgres database.
 * The public schema is dropped + recreated (via the migration
 * runner) before every test so each case starts from a known
 * state. The full migration chain (001-014) is applied so the
 * ``libraries`` + ``device_libraries`` + ``books.library_id``
 * schema additions from PR-N2 are present.
 */

const hasDb = !!process.env.DATABASE_URL;
const describeDb = hasDb ? describe : describe.skip;

describeDb('LibrariesRepository', () => {
  const repo: LibrariesRepository = createLibrariesRepository({
    connectionString: DATABASE_URL,
  });

  beforeEach(async () => {
    await resetAndMigrate(__dirname);
  });

  afterAll(async () => {
    await repo.close();
  });

  /* ---------- list / findById ---------- */

  it('list returns an empty array when the libraries table is fresh', async () => {
    const rows = await repo.list();
    expect(rows).toEqual([]);
  });

  it('insert + findById round-trip a library row', async () => {
    const inserted = await repo.insert({
      name: 'Borges',
      rootPath: '/library/borges',
      createdByDeviceId: '11111111-1111-1111-1111-111111111111',
    });
    expect(inserted.id).toBeGreaterThan(0);
    expect(inserted.name).toBe('Borges');
    expect(inserted.rootPath).toBe('/library/borges');
    expect(inserted.createdByDeviceId).toBe('11111111-1111-1111-1111-111111111111');
    expect(inserted.createdAt).toBeInstanceOf(Date);

    const found = await repo.findById(inserted.id);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(inserted.id);
    expect(found?.name).toBe('Borges');
    expect(found?.rootPath).toBe('/library/borges');
  });

  it('findById returns null when no such library exists', async () => {
    const found = await repo.findById(9_999_999);
    expect(found).toBeNull();
  });

  it('list returns every library ordered by id ASC', async () => {
    const a = await repo.insert({
      name: 'A',
      rootPath: '/lib/a',
      createdByDeviceId: null,
    });
    const b = await repo.insert({
      name: 'B',
      rootPath: '/lib/b',
      createdByDeviceId: null,
    });
    const c = await repo.insert({
      name: 'C',
      rootPath: '/lib/c',
      createdByDeviceId: null,
    });
    const rows = await repo.list();
    expect(rows.map((r) => r.id)).toEqual([a.id, b.id, c.id]);
  });

  /* ---------- update ---------- */

  it('update changes only the supplied fields', async () => {
    const inserted = await repo.insert({
      name: 'Original',
      rootPath: '/lib/original',
      createdByDeviceId: null,
    });
    const updated = await repo.update(inserted.id, { name: 'Renamed' });
    expect(updated).not.toBeNull();
    expect(updated?.id).toBe(inserted.id);
    expect(updated?.name).toBe('Renamed');
    expect(updated?.rootPath).toBe('/lib/original');

    const updatedRoot = await repo.update(inserted.id, {
      rootPath: '/lib/new-path',
    });
    expect(updatedRoot?.rootPath).toBe('/lib/new-path');
    expect(updatedRoot?.name).toBe('Renamed');
  });

  it('update returns null when the library does not exist', async () => {
    const result = await repo.update(9_999_999, { name: 'X' });
    expect(result).toBeNull();
  });

  /* ---------- delete ---------- */

  it('delete returns true and removes the row', async () => {
    const inserted = await repo.insert({
      name: 'Doomed',
      rootPath: '/lib/doomed',
      createdByDeviceId: null,
    });
    const ok = await repo.delete(inserted.id);
    expect(ok).toBe(true);
    const found = await repo.findById(inserted.id);
    expect(found).toBeNull();
  });

  it('delete returns false when the library does not exist', async () => {
    const ok = await repo.delete(9_999_999);
    expect(ok).toBe(false);
  });

  /* ---------- setActiveForDevice / getActiveForDevice ---------- */

  it('setActiveForDevice marks the device-library pair active', async () => {
    const lib = await repo.insert({
      name: 'Biología',
      rootPath: '/lib/biologia',
      createdByDeviceId: null,
    });
    const deviceId = '22222222-2222-2222-2222-222222222222';
    await repo.setActiveForDevice(deviceId, lib.id);

    const active = await repo.getActiveForDevice(deviceId);
    expect(active).not.toBeNull();
    expect(active?.id).toBe(lib.id);
    expect(active?.name).toBe('Biología');
  });

  it('setActiveForDevice flips the previously active library off', async () => {
    const a = await repo.insert({
      name: 'A',
      rootPath: '/lib/a',
      createdByDeviceId: null,
    });
    const b = await repo.insert({
      name: 'B',
      rootPath: '/lib/b',
      createdByDeviceId: null,
    });
    const deviceId = '33333333-3333-3333-3333-333333333333';
    await repo.setActiveForDevice(deviceId, a.id);
    await repo.setActiveForDevice(deviceId, b.id);

    const active = await repo.getActiveForDevice(deviceId);
    expect(active?.id).toBe(b.id);
  });

  it('getActiveForDevice returns null when the device has no active library', async () => {
    const active = await repo.getActiveForDevice(
      '44444444-4444-4444-4444-444444444444',
    );
    expect(active).toBeNull();
  });

  it('setActiveForDevice is idempotent (calling twice keeps the same active row)', async () => {
    const lib = await repo.insert({
      name: 'Stable',
      rootPath: '/lib/stable',
      createdByDeviceId: null,
    });
    const deviceId = '55555555-5555-5555-5555-555555555555';
    await repo.setActiveForDevice(deviceId, lib.id);
    await repo.setActiveForDevice(deviceId, lib.id);
    const active = await repo.getActiveForDevice(deviceId);
    expect(active?.id).toBe(lib.id);
  });
});
