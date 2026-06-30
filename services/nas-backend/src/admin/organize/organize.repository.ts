import { Pool } from 'pg';
import { buildPool } from '../../database/pg.service';
import {
  NewOrganizePlan,
  OrganizeAction,
  OrganizeActionKind,
  OrganizeActionStatus,
  OrganizePlan,
  OrganizePlanStatus,
  OrganizePlanSummary,
} from './organize.types';

/**
 * String token used to inject the {@link OrganizeRepository}
 * contract inside the NestJS container. Tests override the
 * binding via ``Test.createTestingModule().overrideProvider()``
 * so the service contract can be pinned in isolation.
 */
export const ORGANIZE_REPOSITORY = 'ORGANIZE_REPOSITORY';

interface PlanRow {
  id: string;
  folder_path: string;
  dry_run: boolean | null;
  status: OrganizePlanStatus;
  summary: OrganizePlanSummary | string | null;
  started_at: Date | null;
  finished_at: Date | null;
  error: string | null;
}

interface ActionRow {
  id: string | number;
  plan_id: string;
  source_path: string;
  target_path: string;
  kind: OrganizeActionKind;
  status: OrganizeActionStatus;
  file_hash: string | null;
  error: string | null;
  applied_at: Date | null;
}

const PLAN_COLUMNS =
  'id, folder_path, dry_run, status, summary, ' +
  'started_at, finished_at, error';

const ACTION_COLUMNS =
  'id, plan_id, source_path, target_path, kind, status, ' +
  'file_hash, error, applied_at';

function normaliseSummary(value: unknown): OrganizePlanSummary {
  if (value && typeof value === 'object') {
    return value as OrganizePlanSummary;
  }
  return {
    filesScanned: 0,
    duplicates: 0,
    movesProposed: 0,
    renamesProposed: 0,
    skipped: 0,
  };
}

function rowToPlan(row: PlanRow): OrganizePlan {
  return {
    id: row.id,
    folderPath: row.folder_path,
    dryRun: row.dry_run === true,
    status: row.status,
    summary: normaliseSummary(row.summary),
    startedAt: row.started_at ?? new Date(0),
    finishedAt: row.finished_at,
    error: row.error,
  };
}

function rowToAction(row: ActionRow): OrganizeAction {
  return {
    id: Number(row.id),
    planId: row.plan_id,
    sourcePath: row.source_path,
    targetPath: row.target_path,
    kind: row.kind,
    status: row.status,
    fileHash: row.file_hash,
    error: row.error,
    appliedAt: row.applied_at,
  };
}

/**
 * Repository contract for the ``organize_plans`` + ``organize_actions``
 * tables (PR-N5).
 *
 * The contract covers the methods the HTTP layer and the
 * analyze/execute services need:
 *
 *   - ``insertPlan``          — record a freshly-minted analyze
 *                                 invocation.
 *   - ``getPlan``             — read a single plan by UUID.
 *   - ``insertActions``       — batch insert proposed actions tied
 *                                 to a plan.
 *   - ``listActions``         — per-plan action listing.
 *   - ``markActionApplied``   — flip ``pending`` to one of
 *                                 ``applied|skipped|failed``;
 *                                 idempotent against ``applied``
 *                                 so a double-execute is safe.
 *   - ``updatePlanStatus``    — flip the plan-level status (and
 *                                 stamp ``finished_at`` on
 *                                 terminal transitions).
 *   - ``updatePlanProgress``  — patch the ``summary`` JSON column.
 */
export interface NewOrganizeAction {
  planId: string;
  sourcePath: string;
  targetPath: string;
  kind: OrganizeActionKind;
  fileHash: string | null;
}

export interface OrganizeRepository {
  insertPlan(
    plan: NewOrganizePlan,
    summary: OrganizePlanSummary,
  ): Promise<OrganizePlan>;
  getPlan(id: string): Promise<OrganizePlan | null>;
  insertActions(actions: NewOrganizeAction[]): Promise<OrganizeAction[]>;
  listActions(planId: string): Promise<OrganizeAction[]>;
  markActionApplied(
    id: number,
    status: 'applied' | 'skipped' | 'failed',
    error?: string,
  ): Promise<OrganizeAction | null>;
  updatePlanStatus(
    id: string,
    status: OrganizePlanStatus,
    error?: string,
  ): Promise<OrganizePlan | null>;
  updatePlanProgress(
    id: string,
    summary: OrganizePlanSummary,
  ): Promise<OrganizePlan | null>;
  close(): Promise<void>;
}

/**
 * pg-backed implementation of {@link OrganizeRepository}. The pool
 * is shared with the rest of the catalog — see
 * ``DatabaseModule``.
 */
export class PgOrganizeRepository implements OrganizeRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async insertPlan(
    plan: NewOrganizePlan,
    summary: OrganizePlanSummary,
  ): Promise<OrganizePlan> {
    const res = await this.pool.query<PlanRow>(
      `INSERT INTO organize_plans (id, folder_path, dry_run, summary)
       VALUES ($1, $2, $3, $4::JSONB)
       RETURNING ${PLAN_COLUMNS}`,
      [
        plan.planId,
        plan.folderPath,
        plan.dryRun,
        JSON.stringify(summary),
      ],
    );
    return rowToPlan(res.rows[0]);
  }

  async getPlan(id: string): Promise<OrganizePlan | null> {
    const res = await this.pool.query<PlanRow>(
      `SELECT ${PLAN_COLUMNS} FROM organize_plans WHERE id = $1`,
      [id],
    );
    if (res.rowCount === 0) return null;
    return rowToPlan(res.rows[0]);
  }

  async insertActions(
    actions: NewOrganizeAction[],
  ): Promise<OrganizeAction[]> {
    if (actions.length === 0) return [];
    // Build the multi-row INSERT dynamically. ``unnest`` keeps the
    // bind count constant regardless of batch size and avoids the
    // round-trip cost of N parameterized statements.
    const ids: string[] = [];
    const sources: string[] = [];
    const targets: string[] = [];
    const kinds: OrganizeActionKind[] = [];
    const hashes: (string | null)[] = [];
    for (const a of actions) {
      ids.push(a.planId);
      sources.push(a.sourcePath);
      targets.push(a.targetPath);
      kinds.push(a.kind);
      hashes.push(a.fileHash);
    }
    const res = await this.pool.query<ActionRow>(
      `INSERT INTO organize_actions
         (plan_id, source_path, target_path, kind, file_hash)
       SELECT * FROM UNNEST($1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[])
       RETURNING ${ACTION_COLUMNS}`,
      [ids, sources, targets, kinds, hashes],
    );
    return res.rows.map(rowToAction);
  }

  async listActions(planId: string): Promise<OrganizeAction[]> {
    const res = await this.pool.query<ActionRow>(
      `SELECT ${ACTION_COLUMNS}
         FROM organize_actions
        WHERE plan_id = $1
        ORDER BY id ASC`,
      [planId],
    );
    return res.rows.map(rowToAction);
  }

  /**
   * Idempotence guarantee for execute:
   *
   *   - For terminal statuses (``applied``/``failed``) we DO NOT
   *     touch a row that is already in that state, so the original
   *     ``applied_at`` timestamp (and any ``error`` message) is
   *     preserved for audit.
   *   - For ``skipped`` (the "file was already at target" branch)
   *     the same rule applies - a no-op stays a no-op on a retry.
   *   - Going from one terminal state to another is permitted
   *     only when the caller asks to write the same status (a
   *     safety net; the service layer enforces this too).
   */
  async markActionApplied(
    id: number,
    status: 'applied' | 'skipped' | 'failed',
    error?: string,
  ): Promise<OrganizeAction | null> {
    const res = await this.pool.query<ActionRow>(
      `UPDATE organize_actions
          SET status = $2,
              error = $3,
              applied_at = CASE
                WHEN $2 IN ('applied', 'skipped') THEN NOW()
                ELSE applied_at
              END
        WHERE id = $1
          AND status = 'pending'
        RETURNING ${ACTION_COLUMNS}`,
      [id, status, error ?? null],
    );
    if (res.rowCount !== null && res.rowCount > 0) {
      return rowToAction(res.rows[0]);
    }
    // No pending row matched — fetch the existing row so the caller
    // gets a stable "current state" handle.
    const existing = await this.pool.query<ActionRow>(
      `SELECT ${ACTION_COLUMNS} FROM organize_actions WHERE id = $1`,
      [id],
    );
    if (existing.rowCount === 0) return null;
    return rowToAction(existing.rows[0]);
  }

  async updatePlanStatus(
    id: string,
    status: OrganizePlanStatus,
    error?: string,
  ): Promise<OrganizePlan | null> {
    const res = await this.pool.query<PlanRow>(
      `UPDATE organize_plans
          SET status = $2,
              error = $3,
              finished_at = CASE
                WHEN $2 IN ('done', 'failed') THEN NOW()
                ELSE finished_at
              END
        WHERE id = $1
        RETURNING ${PLAN_COLUMNS}`,
      [id, status, error ?? null],
    );
    if (res.rowCount === 0) return null;
    return rowToPlan(res.rows[0]);
  }

  async updatePlanProgress(
    id: string,
    summary: OrganizePlanSummary,
  ): Promise<OrganizePlan | null> {
    const res = await this.pool.query<PlanRow>(
      `UPDATE organize_plans
          SET summary = $2::JSONB
        WHERE id = $1
        RETURNING ${PLAN_COLUMNS}`,
      [id, JSON.stringify(summary)],
    );
    if (res.rowCount === 0) return null;
    return rowToPlan(res.rows[0]);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export interface CreateOrganizeRepositoryOptions {
  connectionString?: string;
  pool?: Pool;
}

/**
 * Factory used by tests and the NestJS container. Accepts an
 * already-built pool (production wiring) or a connection string
 * (test convenience).
 */
export function createOrganizeRepository(
  options: CreateOrganizeRepositoryOptions = {},
): OrganizeRepository {
  const pool = options.pool ?? buildPool(options.connectionString);
  return new PgOrganizeRepository(pool);
}
