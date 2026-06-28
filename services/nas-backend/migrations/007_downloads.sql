-- 007_downloads.sql — per-device download audit trail.
--
-- One row per download attempt. The combination ``(device_id, book_id,
-- downloaded_at)`` is a useful unique key but is not enforced as a
-- constraint because a flaky connection may legitimately produce
-- multiple ``completed = false`` rows before a successful retry.
--
-- ``bytes_transferred`` is updated as the file streams so partial
-- downloads can be resumed from the last successful byte.
--
-- All statements are idempotent.

CREATE TABLE IF NOT EXISTS downloads (
  id                  BIGSERIAL PRIMARY KEY,
  book_id             BIGINT      NOT NULL REFERENCES books (id) ON DELETE CASCADE,
  device_id           UUID,
  device_name         TEXT,
  user_id             UUID,
  downloaded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  file_size_bytes     BIGINT,
  bytes_transferred   BIGINT,
  completed           BOOLEAN     NOT NULL DEFAULT FALSE,
  ip_address          INET,
  user_agent          TEXT
);

CREATE INDEX IF NOT EXISTS downloads_device_id_idx
  ON downloads (device_id, downloaded_at DESC);

CREATE INDEX IF NOT EXISTS downloads_book_id_idx
  ON downloads (book_id);