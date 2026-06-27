# Especificación de Empaquetado

## Propósito

Bundles the application as a macOS `.app` via py2app so the user can install by double-click and so all data lives in the canonical OS-managed location (`~/Library/Application Support/Alejandria/`). The bundle must launch on a clean Mac with only system Python plus its bundled dependencies, and all paths must be resolved at runtime through `platformdirs` so the bundle remains portable across machines and usernames.

## Requisitos

### Requisito: Bundle .app basado en py2app

The system MUST provide a `setup.py` (or equivalent py2app configuration) that builds a `.app` bundle. The build MUST produce a standalone application that double-clicks to launch on a clean Mac without requiring the user to install Python or pip packages manually.

#### Escenario: El build produce un .app que se puede abrir

- DADO `setup.py` is configured for py2app
- CUANDO the developer runs `python setup.py py2app`
- ENTONCES a `dist/Alejandria.app` directory is produced
- Y double-clicking the bundle on a clean Mac launches the FastAPI server and opens the UI in the default browser

#### Escenario: La app sobrevive al moverse entre usuarios

- DADO `Alejandro.app` is built under `/Users/alice/...` and copied to `/Users/bob/Applications/`
- CUANDO `bob` double-clicks the bundle
- ENTONCES all data paths resolve to `/Users/bob/Library/Application Support/Alejandria/`
- Y no source code path leaks `alice`'s username

### Requisito: Paths de datos portables vía platformdirs

The system MUST resolve all data paths (libraries DB folder, thumbnails folder, registry file, logs) through `platformdirs` (or equivalent) at runtime. The system MUST NOT contain any hard-coded `/Users/<name>/...` path in source.

#### Escenario: La carpeta de bibliotecas es gestionada por el SO

- DADO the app is running as user `me` on macOS
- CUANDO the registry needs a data folder
- ENTONCES `platformdirs.user_data_dir("Alejandria", "com.alejandria")` returns `~/Library/Application Support/Alejandria/`
- Y `libraries/`, `thumbnails/`, and `libraries.json` are created under that root

#### Escenario: No hay paths literales de usuario en el código fuente

- DADO the codebase is searched for `/Users/<name>/`
- CUANDO a lint check runs
- ENTONCES zero matches are reported
- Y no relative path includes a literal user segment

### Requisito: Metadata del bundle en Info.plist

The system MUST set the bundle identifier to `com.alejandria.app` and the version to the value in `pyproject.toml` (or equivalent) inside `Info.plist`. The bundle MUST show the correct app name in the macOS menu bar.

#### Escenario: El nombre y la versión de la app son visibles en la menu bar

- DADO `pyproject.toml` defines `version = "0.1.0"`
- CUANDO the app launches
- ENTONCES the macOS menu bar shows `Alejandria` as the app name
- Y `About Alejandria` reports version `0.1.0`

### Requisito: Script de build con output reproducible

The system MUST provide a `build_app.sh` (or equivalent) that runs the full build (npm install, vite build, py2app) and writes the bundle to `dist/Alejandria.app`. The script MUST be idempotent.

#### Escenario: Un checkout fresco buildea la app

- DADO a clean clone of the repo with no `node_modules/`, `build/`, or `dist/`
- CUANDO the developer runs `./build_app.sh`
- ENTONCES `dist/Alejandria.app` exists and launches

### Requisito: Scripts de bootstrap y desarrollo

The system MUST provide `bootstrap.sh` (one-shot setup of Python venv, npm install, py2app build) and `dev.sh` (run FastAPI + Vite dev server for local development). The dev workflow MUST NOT require the `.app` bundle.

#### Escenario: El modo dev corre sin bundle

- DADO the developer wants to iterate on the UI
- CUANDO they run `./dev.sh`
- ENTONCES the FastAPI server and Vite dev server start
- Y the React UI loads from Vite (not the bundled `dist/`)

## Referencias cruzadas

- Depends on: `library-registry` (provides the path helper contract)
- Consumed by: every other capability (the app launches via this bundle)