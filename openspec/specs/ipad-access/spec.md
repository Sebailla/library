# Especificación de Acceso desde iPad

## Propósito

Makes the same catalog and reader available on an iPad over Tailscale (primary) or the local LAN (fallback) so the user can read and study on the iPad while the Mac stays in charge of the catalog. The Mac binds the FastAPI server to a configurable port, exposes a menu-bar widget with the current access URL, and the iPad opens that URL in Safari.

## Requisitos

### Requisito: Acceso desde iPad basado en Tailscale (primario)

The system MUST bind the FastAPI server to `0.0.0.0` on a configurable port (default `8000`). When Tailscale is installed on the Mac, the iPad MUST be able to open the catalog at `http://<mac-tailscale-name>:<port>` in Safari and see the same UI as on the Mac. The system MUST document the Tailscale setup in `README` with a 5-minute target from a fresh Tailscale install on both devices.

#### Escenario: El iPad abre el catálogo sobre Tailscale

- DADO Tailscale is installed and connected on both Mac and iPad
- CUANDO the user enters `http://alejandria-mac:8000` in iPad Safari
- ENTONCES the catalog UI loads
- Y the active library, file list, and search work identically to the Mac

#### Escenario: El README documenta el setup de Tailscale

- DADO the user is new to Tailscale
- CUANDO they read the README iPad section
- ENTONCES the steps are: install Tailscale on Mac, install on iPad, sign in with the same account, run `./dev.sh` (or launch the `.app`), open `http://<mac-tailscale-name>:8000` in iPad Safari

### Requisito: Widget de URL en la menu bar del Mac

The system MUST expose a macOS menu-bar item that displays the current Tailscale URL of the running server and a copy-to-clipboard button. The widget MUST update when the port changes or when the Tailscale IP changes.

#### Escenario: La menu bar muestra la URL

- DADO the app is running on port 8000 with Tailscale IP `100.64.0.5`
- CUANDO the user opens the menu-bar item
- ENTONCES they see `http://alejandria-mac:8000` (or the equivalent Tailscale hostname)
- Y clicking "Copy" puts that URL on the clipboard

### Requisito: Fallback LAN para usuarios sin Tailscale

The system MUST allow access via the Mac's local LAN IP at `http://<mac-local-ip>:<port>` as a fallback for users who do not want to install Tailscale. The README MUST document the LAN fallback and its limitation: same-Wi-Fi only.

#### Escenario: El iPad abre el catálogo sobre LAN

- DADO the Mac's local IP is `192.168.1.42` and the server is on port `8000`
- CUANDO the user enters `http://192.168.1.42:8000` in iPad Safari on the same Wi-Fi
- ENTONCES the catalog UI loads
- Y the user is NOT required to install Tailscale

### Requisito: El servidor es solo local, nunca público

The system MUST NOT expose the FastAPI server to the public internet. There MUST be no port-forwarding, ngrok, or public-tunnel integration in v1. The system MUST NOT listen on any interface other than the local / Tailscale interfaces; binding MUST be limited to `0.0.0.0` with no public DNS or external reverse proxy.

#### Escenario: Sin exposición pública

- DADO the app is running
- CUANDO the user scans their public IP from a remote network
- ENTONCES the server is unreachable from the public internet
- Y the local + Tailscale interfaces work normally

### Requisito: Misma UI en Mac y iPad

The catalog, reader, and annotation UI MUST be the same React codebase rendered in both Mac and iPad Safari. The system MUST NOT ship a separate iPad app or iPad-specific HTML. The UI MUST be responsive (usable at iPad widths) without a separate mobile breakpoint.

#### Escenario: Mac e iPad muestran la misma UI

- DADO the Mac renders the catalog at 1440 px wide
- CUANDO the iPad renders the catalog at 1024 px wide (landscape)
- ENTONCES the same React app loads
- Y the layout adapts (sidebar / grid) without a separate iPad HTML

### Requisito: Puerto configurable

The system MUST allow the user to configure the server port (default `8000`) via a config file or environment variable. The menu-bar widget MUST reflect the actual port in use.

#### Escenario: El usuario cambia el puerto a 9000

- DADO the default port is `8000`
- CUANDO the user sets `ALEJANDRIA_PORT=9000` and restarts the app
- ENTONCES the server binds on `0.0.0.0:9000`
- Y the menu-bar widget shows `http://alejandria-mac:9000`

## Referencias cruzadas

- Depends on: `packaging` (the `.app` runs the server), `annotations` (sync target)
- Consumed by: `pdf-reader`, `epub-reader` (iPad renders the same readers)