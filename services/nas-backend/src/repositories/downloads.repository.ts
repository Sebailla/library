import { Pool } from 'pg';
import { buildPool } from '../database/pg.service';

/** Shape of a row in the ``downloads`` table. */
export interface Download {
  id: number;
  bookId: number;
  deviceId: string | null;
  deviceName: string | null;
  userId: string | null;
  downloadedAt: Date;
  fileSizeBytes: number | null;
  bytesTransferred: number | null;
  completed: boolean;
  ipAddress: string | null;
  userAgent: string | null;
}

/** Subset of {@link Download} accepted by ``insert``. */
export interface NewDownload {
  bookId: number;
  deviceId?: string | null;
  deviceName?: string | null;
  userId?: string | null;
  fileSizeBytes?: number | null;
  bytesTransferred?: number | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

interface DownloadRow {
  id: string | number;
  book_id: string | number;
  device_id: string | null;
  device_name: string | null;
  user_id: string | null;
  downloaded_at: Date;
  file_size_bytes: string | number | null;
  bytes_transferred: string | number | null;
  completed: boolean;
  ip_address: string | null;
  user_agent: string | null;
}

function rowToDownload(row: DownloadRow): Download {
  return {
    id: Number(row.id),
    bookId: Number(row.book_id),
    deviceId: row.device_id,
    deviceName: row.device_name,
    userId: row.user_id,
    downloadedAt: row.downloaded_at,
    fileSizeBytes:
      row.file_size_bytes === null ? null : Number(row.file_size_bytes),
    bytesTransferred:
      row.bytes_transferred === null
        ? null
        : Number(row.bytes_transferred),
    completed: row.completed,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
  };
}

const COLUMNS =
  'id, book_id, device_id, device_name, user_id, downloaded_at, ' +
  'file_size_bytes, bytes_transferred, completed, ip_address, user_agent';

/** Repository contract for the ``downloads`` table. */
export interface DownloadsRepository {
  insert(download: NewDownload): Promise<Download>;
  markCompleted(id: number, bytesTransferred: number): Promise<void>;
  listByDevice(deviceId: string, opts?: { limit?: number }): Promise<Download[]>;
  findById(id: number): Promise<Download | null>;
  close(): Promise<void>;
}

export class PgDownloadsRepository implements DownloadsRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async insert(download: NewDownload): Promise<Download> {
    const res = await this.pool.query<DownloadRow>(
      `INSERT INTO downloads (
         book_id, device_id, device_name, user_id,
         file_size_bytes, bytes_transferred, ip_address, user_agent
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${COLUMNS}`,
      [
        download.bookId,
        download.deviceId ?? null,
        download.deviceName ?? null,
        download.userId ?? null,
        download.fileSizeBytes ?? null,
        download.bytesTransferred ?? null,
        download.ipAddress ?? null,
        download.userAgent ?? null,
      ],
    );
    return rowToDownload(res.rows[0]);
  }

  async markCompleted(id: number, bytesTransferred: number): Promise<void> {
    await this.pool.query(
      `UPDATE downloads
       SET completed = TRUE, bytes_transferred = $2
       WHERE id = $1`,
      [id, bytesTransferred],
    );
  }

  async listByDevice(
    deviceId: string,
    opts: { limit?: number } = {},
  ): Promise<Download[]> {
    const limit = opts.limit ?? 100;
    const res = await this.pool.query<DownloadRow>(
      `SELECT ${COLUMNS}
       FROM downloads
       WHERE device_id = $1
       ORDER BY downloaded_at DESC, id DESC
       LIMIT $2`,
      [deviceId, limit],
    );
    return res.rows.map(rowToDownload);
  }

  async findById(id: number): Promise<Download | null> {
    const res = await this.pool.query<DownloadRow>(
      `SELECT ${COLUMNS} FROM downloads WHERE id = $1`,
      [id],
    );
    if (res.rowCount === 0) return null;
    return rowToDownload(res.rows[0]);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export interface CreateDownloadsRepositoryOptions {
  connectionString?: string;
  pool?: Pool;
}

export function createDownloadsRepository(
  options: CreateDownloadsRepositoryOptions = {},
): DownloadsRepository {
  const pool = options.pool ?? buildPool(options.connectionString);
  return new PgDownloadsRepository(pool);
}