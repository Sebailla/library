-- 012_libraries.sql — libraries table.
--
-- One row per library the catalog covers. ``name`` is the
-- user-visible label (e.g. "Biología", "Borges, Jorge Luis");
-- ``root_path`` is the on-disk directory the scanner will walk
-- when this library is the active one for a given device.
--
-- ``created_by_device_id`` records the UUID of the device that
-- minted the row. The service layer enforces that ONLY this
-- device may PATCH or DELETE the library, so the column doubles
-- as the authorisation anchor for the /api/libraries surface.
--
-- The column is nullable for two reasons:
--   1. Pre-existing libraries imported by a one-shot migration
--      may not have a clear creator (e.g. data lifts from the
--      MVP's ``libraries.json``).
--   2. Operators may insert a library directly via SQL during
--      bring-up before any device has paired.
--
-- All statements are idempotent so the runner can re-apply this
-- file safely.

CREATE TABLE IF NOT EXISTS libraries (
  id                    BIGSERIAL PRIMARY KEY,
  name                  TEXT        NOT NULL,
  root_path             TEXT        NOT NULL,
  created_by_device_id  UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Look-ups by creator are the authorisation query for the PATCH
-- and DELETE routes, so the index is required (not optional).
CREATE INDEX IF NOT EXISTS idx_libraries_created_by_device
  ON libraries (created_by_device_id)
  WHERE created_by_device_id IS NOT NULL;
