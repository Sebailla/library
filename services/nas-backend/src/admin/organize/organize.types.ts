/**
 * Domain types for the admin organize surface (PR-N5).
 *
 * The HTTP controller, the analyze service, the execute service,
 * and the repository all speak the same in-process shapes defined
 * here. Wire-format (snake_case) lives in ``organize.controller.ts``;
 * everything below is camelCase to match the rest of the codebase.
 *
 * Two-pass model (per
 * ``openspec/changes/alejandria-v2/specs/file-organization-pipeline/spec.md``):
 *
 *   analyze(folder_path, dry_run) → OrganizePlan + OrganizeAction[]
 *   execute(plan_id, approved_action_ids) → mark actions applied
 *
 * Idempotence: every {@link OrganizeAction} keeps its ``status`` so
 * a second execute call (or a client retry) flips nothing - the
 * mark-applied path checks ``status = 'pending'`` first.
 */

import { AnalyzeRequest, ExecuteRequest, ExecuteResponse } from './organize.contract';

/**
 * The three flavours of proposed action the analyze step records.
 *
 *   - ``move``   — file goes to a new directory (same basename).
 *   - ``rename`` — file basename changes (same directory).
 *   - ``skip``   — analyze declined to propose a move because
 *     metadata was insufficient / source already at the target.
 *
 * The kind drives both the analyzer's decision-tree and the
 * repository's CHECK constraint; an action whose kind is unknown
 * is rejected at the DB layer so a typo in a future caller cannot
 * silently smuggle a row through.
 */
export type OrganizeActionKind = 'move' | 'rename' | 'skip';

export type OrganizeActionStatus = 'pending' | 'applied' | 'skipped' | 'failed';

export type OrganizePlanStatus = 'analyzing' | 'ready' | 'executing' | 'done' | 'failed';

/**
 * A single proposed file move. ``status`` persists across execute
 * calls so re-runs are no-ops.
 */
export interface OrganizeAction {
  id: number;
  planId: string;
  sourcePath: string;
  targetPath: string;
  kind: OrganizeActionKind;
  status: OrganizeActionStatus;
  fileHash: string | null;
  error: string | null;
  appliedAt: Date | null;
}

/**
 * Input shape accepted by {@link OrganizeService.analyze}. The
 * service derives the rest (plan id, action list, summary).
 */
export interface NewOrganizePlan {
  id: string;
  folderPath: string;
  dryRun: boolean;
}

/**
 * Aggregate counts the analyze response serialises back to the
 * client so the operator can render a preview without enumerating
 * every action.
 */
export interface OrganizePlanSummary {
  filesScanned: number;
  duplicates: number;
  movesProposed: number;
  renamesProposed: number;
  skipped: number;
}

/**
 * Top-level plan row. ``summary`` is the JSON column written on
 * insert; the service keeps it as a typed {@link OrganizePlanSummary}
 * via the repository mapper.
 */
export interface OrganizePlan {
  id: string;
  folderPath: string;
  dryRun: boolean;
  status: OrganizePlanStatus;
  summary: OrganizePlanSummary;
  startedAt: Date;
  finishedAt: Date | null;
  error: string | null;
}

/**
 * Aggregate counts the execute response returns so the client can
 * show a "X of Y applied" counter. ``skipped`` counts actions that
 * were already at target (idempotent no-op). ``failed`` lists the
 * action ids that could not be moved.
 */
export interface OrganizeExecuteSummary {
  applied: number;
  skipped: number;
  failed: number;
  failedActionIds: number[];
}

export type { AnalyzeRequest, ExecuteRequest, ExecuteResponse };
