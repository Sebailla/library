-- 010_devices.sql — paired devices table for PIN-based auth.
--
-- One row per device that has successfully completed
-- ``POST /api/auth/pair``. The ``device_id`` is a UUID minted by
-- the server and returned in the pair response; the JWT issued at
-- pairing time references it.
--
-- ``token_hash`` stores a bcrypt digest of the issued JWT (NOT the
-- JWT itself) so a stolen database row does not yield a usable
-- bearer token. ``refresh`` rotates this hash atomically.
--
-- ``ip_address`` records the address the device paired from so the
-- admin UI can show it as a hint; it is mutable because residential
-- CGNAT addresses change.
--
-- All statements are idempotent so the runner can re-apply this
-- file safely.

CREATE TABLE IF NOT EXISTS devices (
  id              BIGSERIAL PRIMARY KEY,
  device_id       UUID        UNIQUE NOT NULL,
  device_name     TEXT,
  token_hash      TEXT        NOT NULL,
  paired_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ,
  ip_address      INET
);

CREATE INDEX IF NOT EXISTS devices_device_id_idx
  ON devices (device_id);
