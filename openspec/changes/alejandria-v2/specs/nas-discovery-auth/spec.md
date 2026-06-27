# nas-discovery-auth Specification

## Purpose

Discovers the NAS on the local network via mDNS/Bonjour (LAN) and on Tailscale (remote). After discovery, requires a one-time PIN-based pairing to issue a per-device bearer token. The bearer token gates every API call on the NAS.

## Requirements

### Requirement: mDNS discovery on LAN

The NAS NestJS process MUST advertise itself as `_alejandria._tcp` on port 8000 via mDNS. Devices running on the same LAN MUST discover the service without manual configuration and MUST receive the host + port pair.

#### Scenario: LAN discovery finds the NAS automatically

- GIVEN the Mac and the NAS are on the same LAN
- WHEN the Mac boots and the discovery client runs
- THEN within 5 seconds the NAS appears in the discovered list with host + port

#### Scenario: mDNS is also reachable over Tailscale

- GIVEN both devices are connected via Tailscale
- WHEN the Mac discovery client runs
- THEN the NAS appears in the discovered list (Tailscale advertises mDNS across the tailnet)

### Requirement: Tailscale discovery fallback

When mDNS returns zero results, the system MUST fall back to discovering the NAS via the Tailscale MagicDNS name (`alejandria-nas.tailnet-name.ts.net`). If that name resolves, the system MUST add it to the discovered list.

#### Scenario: mDNS zero results falls back to MagicDNS

- GIVEN mDNS returns no NAS
- WHEN the discovery client falls back
- THEN `alejandria-nas.tailnet-name.ts.net` is resolved
- AND if DNS resolves, the NAS is added to the discovered list with port 8000

### Requirement: PIN-based pairing

Pairing MUST require the user to enter a 6-digit PIN shown on the NAS admin UI. `POST /api/auth/pair` accepts `{pin, device_name}` and returns `{device_id, bearer_token}`. The PIN MUST rotate on each successful pair. The PIN MUST expire after 10 minutes of inactivity.

#### Scenario: Correct PIN issues a token

- GIVEN the NAS admin UI shows PIN `123456`
- WHEN the client POSTs `{pin: "123456", device_name: "iPad de Seba"}`
- THEN the response is `{device_id: "uuid", bearer_token: "..."}`
- AND the PIN rotates immediately

#### Scenario: Wrong PIN is rejected with 401

- GIVEN the NAS admin UI shows PIN `123456`
- WHEN the client POSTs `{pin: "000000", device_name: "X"}`
- THEN status is `401` and `code = "BAD_PIN"`

#### Scenario: Expired PIN is rejected

- GIVEN the PIN was generated 11 minutes ago and not used
- WHEN the client POSTs that PIN
- THEN status is `401` and `code = "PIN_EXPIRED"`

### Requirement: Bearer token gates non-health endpoints

Every NAS endpoint except `GET /health` MUST require an `Authorization: Bearer <token>` header. Missing or invalid tokens MUST return `401`.

#### Scenario: Health endpoint is open

- GIVEN no token is configured
- WHEN `GET /health` is issued
- THEN status is `200` and the body is `{"status": "ok"}`

#### Scenario: Books endpoint rejects missing token

- GIVEN no token is configured
- WHEN `GET /api/books/X` is issued
- THEN status is `401` and `code = "UNAUTHORIZED"`

### Requirement: Token rotation per device

A device MAY request a new bearer token by POSTing to `/api/auth/refresh` with its current valid token. The old token MUST be invalidated atomically. Tokens MUST NOT be reused across devices.

#### Scenario: Token refresh succeeds

- GIVEN the device has a valid token `T1`
- WHEN `POST /api/auth/refresh` with `Authorization: Bearer T1` is issued
- THEN the response is `{bearer_token: "T2"}`
- AND `T1` immediately returns `401`

## Cross-references

- Depends on: `nas-catalog-service` (HTTP API surface)
- Consumed by: `nas-browse-download` (issues token before first download)
- Pairing UX: admin web UI on the NAS at `/admin/pairing`