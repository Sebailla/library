import { Pool, PoolClient } from 'pg';
import { buildPool } from '../database/pg.service';
import {
  DeviceLibrary,
  Library,
  LibraryPatch,
  NewLibrary,
} from './libraries.types';

/**
 * pg-backed repository for the ``libraries`` and
 * ``device_libraries`` tables (PR-N2).
 *
 * The shape mirrors the rest of the catalog repositories
 * (``BooksRepository``, ``AuthorsRepository``): a ``Pool`` is
 * injected, every method returns the camel-cased row, and the
 * ``createLibrariesRepository`` factory accepts an explicit
 * connection string so the e2e tests can hit a real database
 * without going through NestJS DI.
 */
export interface LibrariesRepository {
  list(): Promise<Library[]>;
  findById(id: number): Promise<Library | null>;
  insert(library: NewLibrary): Promise<Library>;
  update(id: number, patch: LibraryPatch): Promise<Library | null>;
  delete(id: number): Promise<boolean>;
  setActiveForDevice(deviceId: string, libraryId: number): Promise<void>;
  getActiveForDevice(deviceId: string): Promise<Library | null>;
  close(): Promise<void>;
}

interface LibraryRow {
  id: string | number;
  name: string;
  root_path: string;
  created_by_device_id: string | null;
  created_at: Date;
}

function rowToLibrary(row: LibraryRow): Library {
  return {
    id: Number(row.id),
    name: row.name,
    rootPath: row.root_path,
    createdByDeviceId: row.created_by_device_id,
    createdAt: row.created_at,
  };
}

const LIBRARY_COLUMNS =
  'id, name, root_path, created_by_device_id, created_at';

/**
 * pg-backed implementation of {@link LibrariesRepository}. Use
 * {@link createLibrariesRepository} to instantiate it.
 */
export class PgLibrariesRepository implements LibrariesRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async list(): Promise<Library[]> {
    const res = await this.pool.query<LibraryRow>(
      `SELECT ${LIBRARY_COLUMNS} FROM libraries ORDER BY id ASC`,
    );
    return res.rows.map(rowToLibrary);
  }

  async findById(id: number): Promise<Library | null> {
    const res = await this.pool.query<LibraryRow>(
      `SELECT ${LIBRARY_COLUMNS} FROM libraries WHERE id = $1`,
      [id],
    );
    if (res.rowCount === 0) return null;
    return rowToLibrary(res.rows[0]);
  }

  async insert(library: NewLibrary): Promise<Library> {
    const sql = `
      INSERT INTO libraries (name, root_path, created_by_device_id)
      VALUES ($1, $2, $3)
      RETURNING ${LIBRARY_COLUMNS}
    `;
    const client: PoolClient = await this.pool.connect();
    try {
      const res = await client.query<LibraryRow>(sql, [
        library.name,
        library.rootPath,
        library.createdByDeviceId,
      ]);
      return rowToLibrary(res.rows[0]);
    } finally {
      client.release();
    }
  }

  async update(id: number, patch: LibraryPatch): Promise<Library | null> {
    // Build the SET clause dynamically so callers can pass any
    // subset of { name, rootPath }. The fragment is the ONLY
    // thing that changes between invocations, so we still bind
    // the values through $N placeholders to keep the query
    // parameterised (no string interpolation of user data).
    const setFragments: string[] = [];
    const params: unknown[] = [];
    if (patch.name !== undefined) {
      params.push(patch.name);
      setFragments.push(`name = $${params.length}`);
    }
    if (patch.rootPath !== undefined) {
      params.push(patch.rootPath);
      setFragments.push(`root_path = $${params.length}`);
    }
    // Caller passed an empty patch — return the unchanged row
    // rather than issuing a no-op UPDATE. The service layer is
    // expected to reject empty patches before reaching here,
    // but staying defensive keeps the contract simple.
    if (setFragments.length === 0) {
      return this.findById(id);
    }
    params.push(id);
    const sql = `
      UPDATE libraries
         SET ${setFragments.join(', ')}
       WHERE id = $${params.length}
       RETURNING ${LIBRARY_COLUMNS}
    `;
    const res = await this.pool.query<LibraryRow>(sql, params);
    if (res.rowCount === 0) return null;
    return rowToLibrary(res.rows[0]);
  }

  async delete(id: number): Promise<boolean> {
    const res = await this.pool.query('DELETE FROM libraries WHERE id = $1', [
      id,
    ]);
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Upsert the (device_id, library_id) pair and flip every
   * other row for that device to ``active = FALSE`` so the
   * "current browsing target" stays single-valued. The two
   * statements run inside a single transaction so a partial
   * failure cannot leave two libraries marked active.
   */
  async setActiveForDevice(deviceId: string, libraryId: number): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Reset every other active row for this device first so
      // the partial index on (device_id, active) does not end
      // up with multiple TRUE rows.
      await client.query(
        'UPDATE device_libraries SET active = FALSE WHERE device_id = $1',
        [deviceId],
      );
      // Upsert this (device_id, library_id) row to active. The
      // composite PK guarantees uniqueness; ON CONFLICT
      // re-activates the row if the device re-picks a library
      // it had previously deactivated.
      await client.query(
        `INSERT INTO device_libraries (device_id, library_id, active)
         VALUES ($1, $2, TRUE)
         ON CONFLICT (device_id, library_id)
         DO UPDATE SET active = TRUE`,
        [deviceId, libraryId],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async getActiveForDevice(deviceId: string): Promise<Library | null> {
    const res = await this.pool.query<LibraryRow>(
      `SELECT ${LIBRARY_COLUMNS.split(', ')
        .map((c) => `l.${c}`)
        .join(', ')}
         FROM libraries l
         JOIN device_libraries dl
           ON dl.library_id = l.id
        WHERE dl.device_id = $1
          AND dl.active = TRUE
        ORDER BY l.id ASC
        LIMIT 1`,
      [deviceId],
    );
    if (res.rowCount === 0) return null;
    return rowToLibrary(res.rows[0]);
  }

  /**
   * Return the raw ``device_libraries`` membership rows for a
   * device. Exposed for the service layer's "list libraries
   * for this device" queries that the controller does not need
   * today but the next slice will (paired vs. unpaired view).
   */
  async listForDevice(deviceId: string): Promise<DeviceLibrary[]> {
    const res = await this.pool.query<{
      device_id: string;
      library_id: string | number;
      active: boolean;
    }>(
      `SELECT device_id, library_id, active
         FROM device_libraries
        WHERE device_id = $1
        ORDER BY library_id ASC`,
      [deviceId],
    );
    return res.rows.map((row) => ({
      deviceId: row.device_id,
      libraryId: Number(row.library_id),
      active: row.active,
    }));
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export interface CreateLibrariesRepositoryOptions {
  connectionString?: string;
  pool?: Pool;
}

/**
 * Factory used by tests and the NestJS container. Accepts an
 * already-built pool (production wiring) or a connection string
 * (test convenience).
 */
export function createLibrariesRepository(
  options: CreateLibrariesRepositoryOptions = {},
): LibrariesRepository {
  const pool = options.pool ?? buildPool(options.connectionString);
  return new PgLibrariesRepository(pool);
}
