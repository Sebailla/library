-- 017_organize_plans.sql — admin organize plans (PR-N5).
--
-- The admin organize surface lets an operator scan a folder, get a
-- proposed move/rename/dedupe plan, and execute the moves with
-- idempotence. The pipeline is two-pass: ``analyze`` walks the
-- folder and records the proposed actions; ``execute`` re-plays
-- those actions under the same ``plan_id`` and is a no-op the
-- second time around (the file is already at its target).
--
-- Two tables back the workflow:
--
--   ``organize_plans`` — one row per ``POST /api/admin/organize/analyze``
--     invocation. ``id`` is a UUID so the iPad/web client can
--     reconcile the response without a round-trip (same convention
--     as ``scan_jobs`` per PR-N4). ``folder_path`` records where
--     analyze walked so re-running ``GET /api/admin/organize/plans/:id``
--     can resolve the dataset without re-scanning.
--     ``status`` mirrors the scan lifecycle: ``analyzing`` (the
--     walk is still in progress — the analyze endpoint returns
--     synchronously so this is brief, but the column exists for a
--     future async variant), ``ready`` (plan + actions persisted,
--     awaiting execute), ``executing``, ``done``, ``failed``.
--     ``summary`` carries the aggregate counts the controller
--     returns in the analyze response so the client can render
--     the preview without enumerating every action.
--     ``dry_run`` records whether the analyze was run with
--     ``dry_run=true``; execute refuses a plan whose ``dry_run``
--     was true because by construction no file move was ever
--     attempted.
--
--   ``organize_actions`` — one row per proposed file move. ``plan_id``
--     is the FK back to ``organize_plans``. ``source_path`` and
--     ``target_path`` are absolute paths; ``kind`` is constrained to
--     ``'move' | 'rename' | 'skip'`` so a typo cannot smuggle an
--     unknown action through. ``status`` is constrained to
--     ``'pending' | 'applied' | 'skipped' | 'failed'``; the
--     execute endpoint flips ``pending`` → ``applied`` (or
--     ``skipped`` when the file is already at the target) so a
--     second execute is a no-op against every action.
--     ``file_hash`` is the xxhash of the source file at analyze
--     time; ``error`` carries the failure message when
--     ``status = 'failed'``.
--
-- Indexes:
--
--   - ``idx_organize_actions_plan`` — per-plan listing (the GET
--     plan endpoint).
--   - ``idx_organize_plans_status`` — admin list endpoint
--     (newest-first, filtered by status).
--
-- All statements are idempotent so the runner can re-apply this
-- file safely.

CREATE TABLE IF NOT EXISTS organize_plans (
  id UUID PRIMARY KEY,
  folder_path TEXT NOT NULL,
  dry_run BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'analyzing' CHECK (
    status IN ('analyzing', 'ready', 'executing', 'done', 'failed')
  ),
  summary JSONB NOT NULL DEFAULT '{}'::JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  error TEXT
);

CREATE TABLE IF NOT EXISTS organize_actions (
  id BIGSERIAL PRIMARY KEY,
  plan_id UUID NOT NULL REFERENCES organize_plans(id) ON DELETE CASCADE,
  source_path TEXT NOT NULL,
  target_path TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('move', 'rename', 'skip')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'applied', 'skipped', 'failed')
  ),
  file_hash TEXT,
  error TEXT,
  applied_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_organize_actions_plan ON organize_actions(plan_id);
CREATE INDEX IF NOT EXISTS idx_organize_plans_status ON organize_plans(status);
