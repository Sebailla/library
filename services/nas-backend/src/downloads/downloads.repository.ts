import { Pool } from 'pg';
import { buildPool } from '../database/pg.service';

/** String token used to inject the ``DownloadsRepository`` contract. */
export const DOWNLOADS_REPOSITORY = 'DOWNLOADS_REPOSITORY';

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

/** Aggregated response shape for the ``/api/downloads/stats`` endpoint. */
export interface DownloadStats {
  total: number;
  completed: number;
  top_books: Array<{ book_id: number; count: number }>;
  top_devices: Array<{ device_id: string; count: number }>;
}

/**
 * PR-N3 — single row in the response to
 * ``GET /api/downloads/by-book/:book_id``.
 *
 * One row per device that has downloaded the book. ``count`` is
 * the number of download rows (including in-progress) attributed
 * to ``(device_id, book_id)``. ``lastDownloadedAt`` is the most
 * recent ``downloaded_at`` for that pair — useful for the admin
 * dashboard to surface "active readers" vs "downloaded-once-
 * then-stale" devices.
 */
export interface TopDeviceForBook {
  deviceId: string;
  deviceName: string | null;
  count: number;
  lastDownloadedAt: Date;
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

/**
 * Repository contract for the ``downloads`` table.
 *
 * The contract covers every operation the downloads HTTP module and
 * the BullMQ workers need:
 *
 *   - ``insert``               — record a new download attempt.
 *   - ``markCompleted``        — flip ``completed = true`` and record
 *                                the final byte count.
 *   - ``listByDevice``         — newest-first history for a device.
 *   - ``findById``             — read a single row by primary key.
 *   - ``findCompletedForDeviceAndBook``
 *                              — idempotency lookup used by the
 *                                ``POST /api/downloads`` controller:
 *                                "is there already a successful
 *                                download of this book by this
 *                                device?" If yes we re-issue the
 *                                same ``download_id`` with
 *                                ``resume_supported: true``.
 *   - ``stats``                — aggregated counts powering
 *                                ``GET /api/downloads/stats``.
 */
export interface DownloadsRepository {
  insert(download: NewDownload): Promise<Download>;
  markCompleted(id: number, bytesTransferred: number): Promise<void>;
  /**
   * Update a download without flipping the ``completed`` flag — used
   * by the partial-update path of ``PATCH /api/downloads/:id`` so
   * the byte count is observable while the row stays in-progress.
   */
  updateProgress(id: number, bytesTransferred: number): Promise<void>;
  listByDevice(deviceId: string, opts?: { limit?: number }): Promise<Download[]>;
  /**
   * PR-N3 — caller-scoped list for ``GET /api/me/downloads``.
   * Same shape as ``listByDevice``; the service keeps them as
   * distinct methods so future divergences (e.g. an additional
   * ``completed`` filter on the self-history endpoint) do not
   * silently affect the path-param-driven route.
   */
  listForDevice(
    deviceId: string,
    opts?: { limit?: number },
  ): Promise<Download[]>;
  /**
   * PR-N3 — every download for a given book, newest first. Backs
   * the per-book activity log on the admin surface and the
   * in-memory mirror used by the e2e tests.
   */
  findByBookId(bookId: number, opts?: { limit?: number }): Promise<Download[]>;
  findById(id: number): Promise<Download | null>;
  findCompletedForDeviceAndBook(
    deviceId: string,
    bookId: number,
  ): Promise<Download | null>;
  stats(): Promise<DownloadStats>;
  /**
   * PR-N3 — top devices for a given book. Powers
   * ``GET /api/downloads/by-book/:book_id`` (admin-only). Returns
   * at most ``limit`` rows, ordered by ``count`` DESC then
   * ``device_id`` ASC for ties. Rows with ``device_id IS NULL``
   * (legacy / unattributable) are excluded so the response is
   * always a clean per-device ranking.
   */
  topDevicesForBook(bookId: number, limit: number): Promise<TopDeviceForBook[]>;
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

  async updateProgress(id: number, bytesTransferred: number): Promise<void> {
    await this.pool.query(
      `UPDATE downloads
       SET bytes_transferred = $2
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

  /**
   * PR-N3 — caller-scoped list for ``GET /api/me/downloads``.
   * Semantically identical to ``listByDevice`` today (filter by
   * ``device_id``, order by ``downloaded_at DESC``); kept as a
   * separate method so future divergence on the self-history
   * endpoint cannot silently affect the path-param-driven one.
   */
  async listForDevice(
    deviceId: string,
    opts: { limit?: number } = {},
  ): Promise<Download[]> {
    return this.listByDevice(deviceId, opts);
  }

  /**
   * PR-N3 — every download for a given book, newest first. Powers
   * the per-book activity log on the admin surface (a future
   * chained PR may expose ``GET /api/downloads/by-book/:book_id/all``
   * — for PR-N3 the contract is locked here so the admin tooling
   * can call it directly).
   */
  async findByBookId(
    bookId: number,
    opts: { limit?: number } = {},
  ): Promise<Download[]> {
    const limit = opts.limit ?? 100;
    const res = await this.pool.query<DownloadRow>(
      `SELECT ${COLUMNS}
       FROM downloads
       WHERE book_id = $1
       ORDER BY downloaded_at DESC, id DESC
       LIMIT $2`,
      [bookId, limit],
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

  async findCompletedForDeviceAndBook(
    deviceId: string,
    bookId: number,
  ): Promise<Download | null> {
    const res = await this.pool.query<DownloadRow>(
      `SELECT ${COLUMNS}
       FROM downloads
       WHERE device_id = $1 AND book_id = $2 AND completed = TRUE
       ORDER BY downloaded_at DESC, id DESC
       LIMIT 1`,
      [deviceId, bookId],
    );
    if (res.rowCount === 0) return null;
    return rowToDownload(res.rows[0]);
  }

  async stats(): Promise<DownloadStats> {
    // The two grouping queries share the same ``GROUP BY`` plan, so
    // we can run them in parallel against the same pool. The total
    // counts are cheap ``COUNT(*)``s over the full table — the
    // spec's per-book / per-device indexes cover the GROUP BYs.
    const [totals, byBook, byDevice] = await Promise.all([
      this.pool.query<{ total: string; completed: string }>(
        `SELECT COUNT(*)::text AS total,
                COUNT(*) FILTER (WHERE completed)::text AS completed
         FROM downloads`,
      ),
      this.pool.query<{ book_id: string; count: string }>(
        `SELECT book_id, COUNT(*)::text AS count
         FROM downloads
         GROUP BY book_id
         ORDER BY COUNT(*) DESC, book_id ASC`,
      ),
      this.pool.query<{ device_id: string; count: string }>(
        `SELECT device_id, COUNT(*)::text AS count
         FROM downloads
         WHERE device_id IS NOT NULL
         GROUP BY device_id
         ORDER BY COUNT(*) DESC, device_id ASC`,
      ),
    ]);
    return {
      total: Number(totals.rows[0]?.total ?? 0),
      completed: Number(totals.rows[0]?.completed ?? 0),
      top_books: byBook.rows.map((r) => ({
        book_id: Number(r.book_id),
        count: Number(r.count),
      })),
      top_devices: byDevice.rows.map((r) => ({
        device_id: r.device_id,
        count: Number(r.count),
      })),
    };
  }

  async topDevicesForBook(
    bookId: number,
    limit: number,
  ): Promise<TopDeviceForBook[]> {
    // Two aggregates against the same index (idx_downloads_book):
    //   COUNT(*) per (device_id, book_id) — for ``count``.
    //   MAX(downloaded_at) per (device_id, book_id) — for ``last_downloaded_at``.
    // ``device_id IS NOT NULL`` excludes legacy / unattributable
    // rows from the ranking. The tie-break on ``device_id`` ASC
    // matches the per-book stats endpoint so the two surfaces
    // behave consistently for the same book.
    const res = await this.pool.query<{
      device_id: string;
      device_name: string | null;
      count: string;
      last_downloaded_at: Date;
    }>(
      `SELECT device_id,
              MAX(device_name) AS device_name,
              COUNT(*)::text AS count,
              MAX(downloaded_at) AS last_downloaded_at
       FROM downloads
       WHERE book_id = $1 AND device_id IS NOT NULL
       GROUP BY device_id
       ORDER BY COUNT(*) DESC, device_id ASC
       LIMIT $2`,
      [bookId, limit],
    );
    return res.rows.map((row) => ({
      deviceId: row.device_id,
      deviceName: row.device_name,
      count: Number(row.count),
      lastDownloadedAt: row.last_downloaded_at,
    }));
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
