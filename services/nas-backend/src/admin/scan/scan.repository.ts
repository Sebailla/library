import { Pool } from 'pg';
import { buildPool } from '../../database/pg.service';
import { NewScanJob, ScanJob, ScanJobKind, ScanJobStatus } from './scan.types';

/**
 * String token used to inject the {@link ScanRepository} contract
 * inside the NestJS container. Tests override the binding via
 * ``Test.createTestingModule().overrideProvider()`` so the
 * service contract can be pinned in isolation.
 */
export const SCAN_REPOSITORY = 'SCAN_REPOSITORY';

interface ScanJobRow {
  id: string;
  library_id: string | number | null;
  kind: ScanJobKind;
  status: ScanJobStatus;
  started_at: Date | null;
  finished_at: Date | null;
  total_files: number | null;
  processed_files: string | number | null;
  cancelled: boolean | null;
  error: string | null;
}

function rowToScanJob(row: ScanJobRow): ScanJob {
  return {
    id: row.id,
    libraryId: row.library_id === null ? null : Number(row.library_id),
    kind: row.kind,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    totalFiles: row.total_files,
    processedFiles:
      row.processed_files === null ? 0 : Number(row.processed_files),
    cancelled: row.cancelled === true,
    error: row.error,
  };
}

const COLUMNS =
  'id, library_id, kind, status, started_at, finished_at, ' +
  'total_files, processed_files, cancelled, error';

/**
 * Repository contract for the ``scan_jobs`` table (PR-N4).
 *
 * Every method matches what the HTTP controller and the BullMQ
 * worker need:
 *
 *   - ``insertJob``            — record a queued admin request.
 *   - ``getJob``               — read a single row by UUID.
 *   - ``listJobs``             — newest-first history for the
 *                                 admin list endpoint.
 *   - ``setJobStatus``         — flip ``status`` (and stamp
 *                                 ``started_at`` / ``finished_at``
 *                                 when transitioning into /
 *                                 out of ``running``).
 *   - ``updateProgress``       — increment ``processed_files``
 *                                 and stamp ``total_files`` once
 *                                 the worker knows the file count.
 *   - ``requestCancellation``  — flip the cooperative cancel
 *                                 flag. The worker checks it
 *                                 between files.
 *   - ``isCancelled``          — the worker's read-side check.
 *                                 Returns ``false`` for unknown
 *                                 ids so a race on a not-yet-
 *                                 persisted job does not bail
 *                                 out.
 */
export interface ScanRepository {
  insertJob(job: NewScanJob): Promise<ScanJob>;
  getJob(id: string): Promise<ScanJob | null>;
  listJobs(): Promise<ScanJob[]>;
  setJobStatus(id: string, status: ScanJobStatus): Promise<ScanJob | null>;
  /**
   * Persist the diagnostic message on a failed job. The HTTP
   * layer never reads ``error`` other than to surface it in the
   * status DTO; the worker writes it via this method when a
   * ``processFile`` call throws.
   */
  setJobError(id: string, error: string): Promise<ScanJob | null>;
  updateProgress(
    id: string,
    processedFiles: number,
    totalFiles: number | null,
  ): Promise<ScanJob | null>;
  requestCancellation(id: string): Promise<void>;
  isCancelled(id: string): Promise<boolean>;
  close(): Promise<void>;
}

/**
 * pg-backed implementation of {@link ScanRepository}. The pool
 * is shared with the rest of the catalog — see
 * ``DatabaseModule``.
 */
export class PgScanRepository implements ScanRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async insertJob(job: NewScanJob): Promise<ScanJob> {
    const res = await this.pool.query<ScanJobRow>(
      `INSERT INTO scan_jobs (id, library_id, kind)
       VALUES ($1, $2, $3)
       RETURNING ${COLUMNS}`,
      [job.id, job.libraryId, job.kind],
    );
    return rowToScanJob(res.rows[0]);
  }

  async getJob(id: string): Promise<ScanJob | null> {
    const res = await this.pool.query<ScanJobRow>(
      `SELECT ${COLUMNS} FROM scan_jobs WHERE id = $1`,
      [id],
    );
    if (res.rowCount === 0) return null;
    return rowToScanJob(res.rows[0]);
  }

  async listJobs(): Promise<ScanJob[]> {
    const res = await this.pool.query<ScanJobRow>(
      `SELECT ${COLUMNS}
         FROM scan_jobs
        ORDER BY started_at DESC NULLS LAST, id DESC`,
    );
    return res.rows.map(rowToScanJob);
  }

  /**
   * Transition a job to a new ``status``. ``started_at`` is
   * stamped on entry into ``running`` (only — we never rewrite
   * a row that is already running); ``finished_at`` is stamped
   * on every terminal transition (``done`` / ``cancelled`` /
   * ``failed``).
   */
  async setJobStatus(
    id: string,
    status: ScanJobStatus,
  ): Promise<ScanJob | null> {
    const res = await this.pool.query<ScanJobRow>(
      `UPDATE scan_jobs
          SET status = $2,
              started_at = CASE
                WHEN $2 = 'running' AND started_at IS NULL THEN NOW()
                ELSE started_at
              END,
              finished_at = CASE
                WHEN $2 IN ('done', 'cancelled', 'failed') THEN NOW()
                ELSE finished_at
              END
        WHERE id = $1
        RETURNING ${COLUMNS}`,
      [id, status],
    );
    if (res.rowCount === 0) return null;
    return rowToScanJob(res.rows[0]);
  }

  /**
   * Increment ``processed_files`` and optionally stamp
   * ``total_files``. The two are paired so the SSE consumer can
   * render ``processed / total`` from a single read.
   */
  async updateProgress(
    id: string,
    processedFiles: number,
    totalFiles: number | null,
  ): Promise<ScanJob | null> {
    const res = await this.pool.query<ScanJobRow>(
      `UPDATE scan_jobs
          SET processed_files = $2,
              total_files = COALESCE($3, total_files)
        WHERE id = $1
        RETURNING ${COLUMNS}`,
      [id, processedFiles, totalFiles],
    );
    if (res.rowCount === 0) return null;
    return rowToScanJob(res.rows[0]);
  }

  async requestCancellation(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE scan_jobs SET cancelled = TRUE WHERE id = $1`,
      [id],
    );
  }

  async setJobError(
    id: string,
    error: string,
  ): Promise<ScanJob | null> {
    const res = await this.pool.query<ScanJobRow>(
      `UPDATE scan_jobs SET error = $2 WHERE id = $1 RETURNING ${COLUMNS}`,
      [id, error],
    );
    if (res.rowCount === 0) return null;
    return rowToScanJob(res.rows[0]);
  }

  /**
   * Read-side cooperative cancel check. Returns ``false`` for
   * unknown ids so a worker that polls the flag before the row
   * is fully visible (write-after-commit race) does not bail
   * out.
   */
  async isCancelled(id: string): Promise<boolean> {
    const res = await this.pool.query<{ cancelled: boolean | null }>(
      `SELECT cancelled FROM scan_jobs WHERE id = $1`,
      [id],
    );
    return res.rows[0]?.cancelled === true;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export interface CreateScanRepositoryOptions {
  connectionString?: string;
  pool?: Pool;
}

/**
 * Factory used by tests and the NestJS container. Accepts an
 * already-built pool (production wiring) or a connection string
 * (test convenience).
 */
export function createScanRepository(
  options: CreateScanRepositoryOptions = {},
): ScanRepository {
  const pool = options.pool ?? buildPool(options.connectionString);
  return new PgScanRepository(pool);
}