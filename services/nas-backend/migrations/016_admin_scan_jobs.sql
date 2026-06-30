-- 016_admin_scan_jobs.sql — admin-driven full + incremental library scans.
--
-- PR-N4 closes the NAS backend admin scan surface. Before this table
-- the only way to trigger a scan was via the filesystem watcher
-- (PR-2E work unit 2). Operators could not (a) force a full rescan
-- after a metadata correction, (b) request an incremental scan on a
-- specific library, or (c) observe progress without tailing the
-- BullMQ failed/completed sets.
--
-- The ``scan_jobs`` table is the durable record of an admin scan
-- request:
--
--   - ``id`` is a UUID (NOT a BIGSERIAL) so the iPad client can
--     generate it client-side and reconcile the response without a
--     round-trip. The web-side and the NAS-side both speak UUIDs
--     for queued work; a BIGSERIAL would force a translation table.
--   - ``library_id`` is nullable so a future "scan every library"
--     variant can enqueue a NULL-rooted job without breaking the
--     FK contract. PR-N4 always sets it.
--   - ``kind`` is constrained to ``'full' | 'incremental'``. A
--     third value would change the wire semantics and require a
--     spec change first.
--   - ``status`` is constrained to
--     ``'queued' | 'running' | 'done' | 'cancelled' | 'failed'``.
--     ``queued`` is the default; ``cancelled`` is set by the
--     ``POST /api/admin/scan/cancel/:job_id`` endpoint via the
--     ``cancelled`` boolean; ``running`` is set by the worker
--     when it picks the job off the queue; ``done`` / ``failed``
--     are terminal.
--   - ``total_files`` is filled in by the worker AFTER it walks
--     ``library.root_path``; the controller never writes it. NULL
--     means "still counting".
--   - ``processed_files`` is incremented per-file inside the
--     worker. The SSE stream reads it to publish progress.
--   - ``cancelled`` is the cooperative-cancel flag — the worker
--     checks it between files. Kept separate from ``status`` so a
--     "cancel a running job" path can flip the flag without losing
--     the in-flight ``status = 'running'``.
--   - ``error`` carries the failure message when ``status =
--     'failed'``. NULL on every other status.
--
-- Indexes:
--
--   - ``idx_scan_jobs_status`` — list-jobs query (``WHERE status =
--     'queued'`` for the worker pickup loop, ``WHERE status IN (...)
--     ORDER BY started_at DESC`` for the admin list endpoint).
--   - ``idx_scan_jobs_library`` — per-library history view
--     (``WHERE library_id = $1``).
--
-- All statements are idempotent so the runner can re-apply this
-- file safely.

CREATE TABLE IF NOT EXISTS scan_jobs (
  id UUID PRIMARY KEY,
  library_id BIGINT REFERENCES libraries(id),
  kind TEXT NOT NULL CHECK (kind IN ('full', 'incremental')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'cancelled', 'failed')),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  total_files INT,
  processed_files INT DEFAULT 0,
  cancelled BOOLEAN DEFAULT FALSE,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_scan_jobs_status ON scan_jobs(status);
CREATE INDEX IF NOT EXISTS idx_scan_jobs_library ON scan_jobs(library_id);