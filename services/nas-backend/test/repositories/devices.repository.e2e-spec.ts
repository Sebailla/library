import {
  DevicesRepository,
  createDevicesRepository,
} from '../../src/auth/devices.repository';
import { DATABASE_URL, resetAndMigrate } from './_fixtures';

/**
 * Contract tests for ``DevicesRepository`` (PR-2C, hardened PR-N3).
 *
 * The repository is the data-access layer for the paired ``devices``
 * table. PR-N3 widens the contract with ``isAdmin`` so the downloads
 * admin gate (``/api/downloads/stats`` + ``/api/downloads/by-book``)
 * has a stable signal to branch on without having to read every
 * column off the row.
 */

const hasDb = !!process.env.DATABASE_URL;
const describeDb = hasDb ? describe : describe.skip;

describeDb('DevicesRepository', () => {
  const repo: DevicesRepository = createDevicesRepository({
    connectionString: DATABASE_URL,
  });

  beforeEach(async () => {
    await resetAndMigrate(__dirname);
  });

  afterAll(async () => {
    await repo.close();
  });

  it('isAdmin returns false for a freshly-paired device (default column value)', async () => {
    const device = await repo.insert({
      deviceId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      deviceName: 'iPad de Seba',
      tokenHash: 'h',
    });
    // PR-N3 — migration 015 added ``is_admin BOOLEAN DEFAULT FALSE``.
    // A row freshly inserted by the existing ``insert`` helper MUST
    // report ``isAdmin = false`` so legacy callers do not suddenly
    // become admins. Admin promotion is an operator-driven action
    // (manual SQL ``UPDATE``), not an automatic side-effect of
    // pairing.
    expect(await repo.isAdmin(device.deviceId)).toBe(false);
  });

  it('isAdmin returns true after a row is promoted via SQL', async () => {
    const device = await repo.insert({
      deviceId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      deviceName: 'Admin iPad',
      tokenHash: 'h',
    });
    // Promote the row directly. The repository exposes the read
    // side (``isAdmin``) but not a write side — promotion is an
    // operator-only action, not an API surface.
    const pool = new (await import('pg')).Pool({ connectionString: DATABASE_URL });
    try {
      await pool.query('UPDATE devices SET is_admin = TRUE WHERE device_id = $1', [
        device.deviceId,
      ]);
    } finally {
      await pool.end();
    }
    expect(await repo.isAdmin(device.deviceId)).toBe(true);
  });

  it('isAdmin returns false for an unknown device (no false-positive)', async () => {
    // Edge case — the device row does not exist. The repository
    // MUST return ``false`` (NOT throw) so the admin gate treats
    // an unknown bearer as a non-admin rather than 500-ing on a
    // missing row.
    expect(
      await repo.isAdmin('cccccccc-cccc-cccc-cccc-cccccccccccc'),
    ).toBe(false);
  });
});