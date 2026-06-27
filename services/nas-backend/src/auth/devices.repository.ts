/** String token used to inject the ``DevicesRepository`` contract. */
export const DEVICES_REPOSITORY = 'DEVICES_REPOSITORY';

import { Pool } from 'pg';
import { buildPool } from '../database/pg.service';

/** Shape of a row in the ``devices`` table (PR-2C). */
export interface Device {
  id: number;
  deviceId: string;
  deviceName: string | null;
  tokenHash: string;
  pairedAt: Date;
  lastSeenAt: Date | null;
  ipAddress: string | null;
}

/** Subset of {@link Device} accepted by ``insert``. */
export interface NewDevice {
  deviceId: string;
  deviceName?: string | null;
  tokenHash: string;
  ipAddress?: string | null;
}

interface DeviceRow {
  id: string | number;
  device_id: string;
  device_name: string | null;
  token_hash: string;
  paired_at: Date;
  last_seen_at: Date | null;
  ip_address: string | null;
}

function rowToDevice(row: DeviceRow): Device {
  return {
    id: Number(row.id),
    deviceId: row.device_id,
    deviceName: row.device_name,
    tokenHash: row.token_hash,
    pairedAt: row.paired_at,
    lastSeenAt: row.last_seen_at,
    ipAddress: row.ip_address,
  };
}

const COLUMNS =
  'id, device_id, device_name, token_hash, paired_at, last_seen_at, ip_address';

/**
 * Repository contract for the ``devices`` table.
 *
 * ``tokenHash`` stores the bcrypt digest of the issued JWT, never
 * the raw token. ``updateTokenHash`` is used by ``refresh`` to
 * rotate the stored hash atomically.
 */
export interface DevicesRepository {
  insert(device: NewDevice): Promise<Device>;
  findByDeviceId(deviceId: string): Promise<Device | null>;
  updateTokenHash(deviceId: string, tokenHash: string): Promise<void>;
  touch(deviceId: string): Promise<void>;
  close(): Promise<void>;
}

export class PgDevicesRepository implements DevicesRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async insert(device: NewDevice): Promise<Device> {
    const res = await this.pool.query<DeviceRow>(
      `INSERT INTO devices (device_id, device_name, token_hash, ip_address)
       VALUES ($1, $2, $3, $4)
       RETURNING ${COLUMNS}`,
      [
        device.deviceId,
        device.deviceName ?? null,
        device.tokenHash,
        device.ipAddress ?? null,
      ],
    );
    return rowToDevice(res.rows[0]);
  }

  async findByDeviceId(deviceId: string): Promise<Device | null> {
    const res = await this.pool.query<DeviceRow>(
      `SELECT ${COLUMNS} FROM devices WHERE device_id = $1`,
      [deviceId],
    );
    if (res.rowCount === 0) return null;
    return rowToDevice(res.rows[0]);
  }

  async updateTokenHash(deviceId: string, tokenHash: string): Promise<void> {
    await this.pool.query(
      `UPDATE devices SET token_hash = $2 WHERE device_id = $1`,
      [deviceId, tokenHash],
    );
  }

  async touch(deviceId: string): Promise<void> {
    await this.pool.query(
      `UPDATE devices SET last_seen_at = NOW() WHERE device_id = $1`,
      [deviceId],
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export interface CreateDevicesRepositoryOptions {
  connectionString?: string;
  pool?: Pool;
}

export function createDevicesRepository(
  options: CreateDevicesRepositoryOptions = {},
): DevicesRepository {
  const pool = options.pool ?? buildPool(options.connectionString);
  return new PgDevicesRepository(pool);
}
