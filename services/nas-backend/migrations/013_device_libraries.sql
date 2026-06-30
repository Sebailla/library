-- 013_device_libraries.sql — per-device active library.
--
-- The catalog lets each paired device pick which library it is
-- currently browsing. The (device_id, library_id) row carries the
-- device's membership in that library; the ``active`` boolean
-- flags the SINGLE row the device currently treats as its
-- browsing target.
--
-- Multiple rows per device are allowed (one per library the
-- device has access to) but the service layer flips all rows
-- for the device to ``active = FALSE`` before setting the new
-- one, so at most one row per device is active at any time.
--
-- The composite PRIMARY KEY guarantees that a device cannot be
-- double-inserted into the same library; the partial index on
-- ``(device_id, active)`` makes the "find the active library"
-- query a single index seek even with thousands of devices.
--
-- ``ON DELETE CASCADE`` on ``library_id`` means dropping a
-- library tears down every device's membership row in the same
-- transaction. The library service refuses to drop a library
-- that still has books indexed (409 LIBRARY_NOT_EMPTY), so this
-- cascade only fires for empty libraries.
--
-- All statements are idempotent so the runner can re-apply this
-- file safely.

CREATE TABLE IF NOT EXISTS device_libraries (
  device_id  UUID   NOT NULL,
  library_id BIGINT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
  active     BOOLEAN DEFAULT FALSE,
  PRIMARY KEY (device_id, library_id)
);

CREATE INDEX IF NOT EXISTS idx_device_libraries_active
  ON device_libraries(device_id, active);
