-- 011_pgroonga_defrag.sql — nightly pgroonga_index_defrag job.
--
-- 4R review #43 — pgroonga indexes fragment over time as the books
-- table grows (inserts/updates rewrite inverted-index segments).
-- Once fragmentation exceeds ~30% the index slows down. The
-- standard mitigation is to run ``pgroonga_command('defrag', ...)``
-- during a quiet window.
--
-- This migration:
--
--   1. Defines a PL/pgSQL helper ``pgroonga_index_defrag(idx text)``
--      that wraps ``pgroonga_command('defrag', ...)``. The helper
--      makes the call site readable and lets the cron job iterate
--      over multiple indexes without repeating SQL.
--
--   2. Tries to install ``pg_cron`` and schedule a nightly job at
--      03:00 UTC that defrags both ``books_title_pgroonga_idx``
--      and ``books_excerpt_pgroonga_idx``.
--
--      The pg_cron setup is wrapped in a DO block with an
--      ``EXCEPTION`` handler so the migration succeeds even when
--      pg_cron is not installed (the standard pgroonga docker
--      image ships without it). Operators who want nightly
--      defrag must install pg_cron separately — the README's
--      ops runbook documents the install + verification steps.
--
-- Idempotency: every statement uses ``CREATE OR REPLACE`` /
-- ``IF NOT EXISTS`` so re-running this migration is safe. The
-- pg_cron job is de-duplicated by ``jobname`` (unschedule first,
-- then schedule) so a second run replaces the schedule rather
-- than stacking jobs.

-- ---------------------------------------------------------------------------
-- 1. Helper function: pgroonga_index_defrag
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pgroonga_index_defrag(idx text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- ``pgroonga_command('defrag', ...)`` accepts a JSON-ish array
  -- of [key, value] pairs. We pass the target index name so the
  -- command acts on a specific index rather than every pgroonga
  -- index in the database.
  --
  -- ``pgroonga_command`` is provided by the pgroonga extension
  -- (created in 001_extensions.sql). If the extension is missing
  -- the call below will fail loudly — that's the intended
  -- behaviour: we don't want a "no-op" defrag that leaves the
  -- operator thinking the index was defragged when it wasn't.
  PERFORM pgroonga_command(
    'defrag',
    ARRAY[ARRAY['target_name', idx]]
  );
  RAISE LOG 'pgroonga_index_defrag(%) completed', idx;
END;
$$;

COMMENT ON FUNCTION pgroonga_index_defrag(text) IS
  'Defragment a single pgroonga index. Wraps pgroonga_command(''defrag'', ...) for cron-friendly SQL.';

-- ---------------------------------------------------------------------------
-- 2. Schedule the nightly job via pg_cron (best-effort)
-- ---------------------------------------------------------------------------
DO $install_cron$
BEGIN
  -- ``CREATE EXTENSION`` inside a DO block lets us trap the
  -- "extension not installed" error. The handler downgrades to a
  -- NOTICE so the migration succeeds; operators see the warning
  -- and can act on it via the README ops runbook.
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  EXCEPTION WHEN undefined_file OR feature_not_supported THEN
    RAISE NOTICE
      'pg_cron is not installed on this server — skipping nightly defrag schedule. See README "pgroonga ops" for the install + manual schedule steps.';
    RETURN;
  END;

  -- pg_cron is installed. (Re)schedule the job: first unschedule
  -- any prior run so a re-applied migration does not stack
  -- duplicate jobs. ``cron.unschedule`` raises if the job does
  -- not exist; that case is fine on a clean install.
  BEGIN
    PERFORM cron.unschedule('alejandria_pgroonga_defrag');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  PERFORM cron.schedule(
    'alejandria_pgroonga_defrag', -- job name (unique)
    '0 3 * * *',                 -- nightly at 03:00 UTC
    $job$
      SELECT pgroonga_index_defrag('books_title_pgroonga_idx');
      SELECT pgroonga_index_defrag('books_excerpt_pgroonga_idx');
    $job$
  );

  RAISE LOG
    'Scheduled alejandria_pgroonga_defrag job (nightly at 03:00 UTC) on books_title_pgroonga_idx and books_excerpt_pgroonga_idx.';
END;
$install_cron$;