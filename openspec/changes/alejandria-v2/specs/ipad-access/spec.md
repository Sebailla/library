# Delta for ipad-access

## REMOVED Requirements

### Requirement: Acceso desde iPad basado en Tailscale (primario)

(Reason: replaced by the Next.js app running locally on each device with optional NAS browse. The iPad no longer opens a Mac-served URL; it runs the same Electron/Next.js shell.)

#### Scenario: El iPad abre el catálogo sobre Tailscale

- DADO Tailscale is installed and connected on both Mac and iPad
- CUANDO the user enters `http://alejandria-mac:8000` in iPad Safari
- ENTONCES the catalog UI loads
- Y the active library, file list, and search work identically to the Mac

### Requirement: Widget de URL en la menu bar del Mac

(Reason: replaced by Electron Tray API showing NAS pairing state and download status. The legacy URL-on-menubar is no longer needed because the iPad runs the same app.)

#### Scenario: La menu bar muestra la URL

- DADO the app is running on port 8000 with Tailscale IP `100.64.0.5`
- CUANDO the user opens the menu-bar item
- ENTONCES they see `http://alejandria-mac:8000` (or the equivalent Tailscale hostname)
- Y clicking "Copy" puts that URL on the clipboard

### Requirement: Fallback LAN para usuarios sin Tailscale

(Reason: the local-first model means the iPad owns its own copy of the catalog. LAN fallback is no longer needed for routine use; NAS browse is an optional overlay reachable over Tailscale or LAN via the pairing flow.)

#### Scenario: El iPad abre el catálogo sobre LAN

- DADO the Mac's local IP is `192.168.1.42` and the server is on port `8000`
- CUANDO the user enters `http://192.168.1.42:8000` in iPad Safari on the same Wi-Fi
- ENTONCES the catalog UI loads
- Y the user is NOT required to install Tailscale

### Requirement: El servidor es solo local, nunca público

(Reason: the iPad app is a first-class client, not a remote browser over the LAN. The local app MUST NOT expose any service to the public internet; the NAS only exposes its API behind a bearer token.)

#### Scenario: Sin exposición pública

- DADO the app is running
- CUANDO the user scans their public IP from a remote network
- ENTONCES the server is unreachable from the public internet
- Y the local + Tailscale interfaces work normally

### Requirement: Misma UI en Mac y iPad

(Reason: subsumed by the v2 model. The Mac and iPad run the same Next.js 16 App Router code through the Electron shell; the React tree is identical by construction, not by convention.)

#### Scenario: Mac e iPad muestran la misma UI

- DADO the Mac renders the catalog at 1440 px wide
- CUANDO the iPad renders the catalog at 1024 px wide (landscape)
- ENTONCES the same React app loads
- Y the layout adapts (sidebar / grid) without a separate iPad HTML

### Requirement: Puerto configurable

(Reason: the Mac no longer runs an HTTP server for the iPad to hit. The only network surface is the NAS, which has its own configurable port handled by `nas-catalog-service`.)

#### Scenario: El usuario cambia el puerto a 9000

- DADO the default port is `8000`
- CUANDO the user sets `ALEJANDRIA_PORT=9000` and restarts the app
- ENTONCES the server binds on `0.0.0.0:9000`
- Y the menu-bar widget shows `http://alejandria-mac:9000`

## ADDED Requirements

### Requirement: iPad runs the same Electron + Next.js shell

The iPad MUST run the same Electron + Next.js 16 application as the Mac. There is no separate iPad HTML or web client. Activity sync between the iPad and the Mac flows through iCloud Drive JSON, not through a shared HTTP server.

#### Scenario: iPad opens the same app as the Mac

- GIVEN the user installs the app on both a Mac and an iPad
- WHEN the iPad launches the app
- THEN the catalog UI is identical to the Mac
- AND notes sync through iCloud Drive within 5 s

### Requirement: iPad can browse and download from the NAS

The iPad MUST be able to browse and download from the NAS via `nas-browse-download`. Pairing happens once per device; subsequent sessions use the cached bearer token.

#### Scenario: iPad pairs and downloads a book

- GIVEN the user enters the NAS PIN once on the iPad
- WHEN the pairing succeeds
- THEN a token is stored in the iOS keychain
- AND subsequent downloads skip the PIN flow

## Cross-references

- Depends on: `packaging` (Electron build), `nextjs-app-shell`, `local-library-db`, `nas-browse-download`
- Consumed by: end users on iPad
- Replaces: previous FastAPI + Tailscale + Safari flow