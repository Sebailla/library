/**
 * Wire-format (snake_case) shapes the
 * ``/api/admin/organize/*`` endpoints accept and return.
 *
 * Kept in a separate module so the controller can import them
 * without dragging the rest of the organize surface types into
 * the class-validator pipeline.
 */

export interface AnalyzeRequest {
  folder_path: string;
  dry_run?: boolean;
}

export interface ExecuteRequest {
  plan_id: string;
  approved_action_ids: number[];
}

export interface ExecuteResponse {
  plan_id: string;
  summary: {
    applied: number;
    skipped: number;
    failed: number;
    failed_action_ids: number[];
  };
}
