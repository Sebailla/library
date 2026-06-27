# Delta for packaging

## REMOVED Requirements

### Requirement: Bundle .app basado en py2app

(Reason: py2app cannot ship a Next.js renderer inside a Python-bundled .app. The bundle is now produced by Electron-builder + electron-forge and the Python sidecar ships as a helper process inside `Alejandria.app/Contents/Resources/`.)

#### Scenario: El build produce un .app que se puede abrir

- DADO `setup.py` is configured for py2app
- CUANDO the developer runs `python setup.py py2app`
- ENTONCES a `dist/Alejandria.app` directory is produced
- Y double-clicking the bundle on a clean Mac launches the FastAPI server and opens the UI in the default browser

#### Scenario: La app sobrevive al moverse entre usuarios

- DADO `Alejandro.app` is built under `/Users/alice/...` and copied to `/Users/bob/Applications/`
- CUANDO `bob` double-clicks the bundle
- ENTONCES all data paths resolve to `/Users/bob/Library/Application Support/Alejandria/`
- Y no source code path leaks `alice`'s username

### Requirement: Scripts de bootstrap y desarrollo

(Reason: the bootstrap.sh / dev.sh scripts are replaced by `pnpm` workspace commands. The Python sidecar has its own uv-managed virtualenv activated from the Electron main process; the Next.js app is started by `pnpm --filter web dev` during development.)

#### Scenario: El modo dev corre sin bundle

- DADO the developer wants to iterate on the UI
- CUANDO they run `./dev.sh`
- ENTONCES the FastAPI server and Vite dev server start
- Y the React UI loads from Vite (not the bundled `dist/`)

## ADDED Requirements

### Requirement: Build via Electron-builder + electron-forge

The system MUST produce `dist/Alejandria.app` via `electron-builder` with a `forge.config.ts` for development. The build MUST emit:
- A double-clickable `.app` that contains the Next.js renderer, the Electron main process, and the Python sidecar under `Contents/Resources/`.
- A signed `.dmg` for distribution.

#### Scenario: Build produces a launchable .app

- GIVEN `pnpm --filter mac package` runs on macOS 14+
- WHEN the build completes
- THEN `dist/Alejandria.app` exists
- AND double-clicking the bundle launches the app on a clean Mac without any user-side install

#### Scenario: Auto-update is wired

- GIVEN the app has been published to a release channel
- WHEN the user opens the app and a newer version exists
- THEN `electron-updater` prompts the user to install the update
- AND the update applies on next launch

### Requirement: Python sidecar bundled inside the .app

The Python sidecar MUST be packaged inside the `.app` at `Contents/Resources/python-sidecar/`, with its own `pyproject.toml` pinned to `requires-python = ">=3.11,<3.14"`. The Electron main process MUST spawn the sidecar via `child_process.spawn` with the bundled interpreter.

#### Scenario: The sidecar launches from inside the bundle

- GIVEN the `.app` is launched
- WHEN the Electron main process spawns the sidecar
- THEN the sidecar's `alejandria extract` and `alejandria ocr` CLIs respond
- AND the user does not need a separate Python install

#### Scenario: Sidecar fails to start surfaces a clear error

- GIVEN the bundled interpreter cannot run on the user's Mac (e.g. wrong arch)
- WHEN the main process tries to spawn it
- THEN the UI shows "Python sidecar unavailable — check installation"
- AND no crash dialog appears

### Requirement: Reproducible build script

The system MUST provide `scripts/build-app.sh` (or `pnpm run build:mac`) that runs the full chain (`pnpm install`, `pnpm --filter web build`, `pnpm --filter mac package`) and writes the bundle to `dist/`. The script MUST be idempotent.

#### Scenario: A clean checkout produces a buildable app

- GIVEN a fresh clone with no `node_modules/`, `dist/`, or `.venv`
- WHEN the developer runs `pnpm run build:mac`
- THEN `dist/Alejandria.app` exists and launches

### Requirement: Cross-platform package metadata

The system MUST set `package.json` `productName = "Alejandria"` and `version` matching the workspace root `package.json`. The bundle's `Info.plist` MUST carry the same values; the macOS menu bar MUST show "Alejandria" as the app name and `About Alejandria` MUST report the same version.

#### Scenario: The app name and version are visible in the menu bar

- GIVEN `package.json` defines `version = "0.2.0"`
- WHEN the app launches
- THEN the macOS menu bar shows `Alejandria` as the app name
- AND `About Alejandria` reports version `0.2.0`

## Cross-references

- Depends on: `library-registry` (provides the path helper contract), `local-library-db` (data location), `python-sidecar-cli` (sidecar that ships inside the bundle)
- Consumed by: every other capability (the app launches via this bundle)
- Replaces: py2app + FastAPI + Vite flow with Electron-builder + Next.js