# `@alejandria/mac`

Electron 33 shell for the alejandria-v2 macOS app (PR-4C, issue #75).

This package hosts the Next.js web UI in a native window, exposes a
`window.alejandria` IPC bridge to the renderer, and supervises the
Python sidecar process. It is the desktop counterpart to the
`apps/web` Next.js dev server.

## Architecture

```
┌──────────────────────────────┐
│ apps/web  (Next.js, dev 3001)│  ← the renderer
└──────────────┬───────────────┘
               │ loadURL (dev) or app:// (prod)
┌──────────────▼───────────────┐
│ apps/mac  (Electron 33)      │  ← this package
│  ┌─────────────────────────┐ │
│  │ preload.ts → window.    │ │  contextIsolation: true
│  │   alejandria.{download, │ │  nodeIntegration: false
│  │   sync, scan, version}  │ │  sandbox: true
│  └─────────────────────────┘ │
│  ┌─────────────────────────┐ │
│  │ ipc-handlers.ts         │ │  ipcMain.handle('aleja:*')
│  └─────────────────────────┘ │
│  ┌─────────────────────────┐ │
│  │ sidecar-manager.ts      │ │  lazy spawn, SIGTERM/SIGKILL
│  └────────┬────────────────┘ │
└───────────┼──────────────────┘
            │ spawn
            ▼
   ┌──────────────────────┐
   │ python -m            │
   │   alejandria_sidecar │  (shared with apps/web +
   └──────────────────────┘   services/nas-backend)
```

## Scripts

| Command            | What it does                                                |
|--------------------|-------------------------------------------------------------|
| `npm test`         | Run the vitest unit suite (26 tests across 4 files).        |
| `npm run typecheck`| `tsc --noEmit` against the full tsconfig.                   |
| `npm run build`    | Compile `src/*.ts` into `dist/*.js` (electron-forge input). |
| `npm run dev`      | Boot Electron in dev mode (loads `http://localhost:3001`).  |
| `npm run start`    | Same as `dev` (alias).                                      |
| `npm run package`  | `electron-forge package` — produce an unsigned mac build.   |
| `npm run make`     | `electron-forge make` — produce a DMG + ZIP artefact.       |

For `npm run dev` / `npm run start` to be useful, start the
Next.js dev server in another terminal first:

```sh
cd ../web
npm run dev
# → Next.js ready on http://localhost:3001
```

## Security model

The renderer is a plain Next.js app that has no idea it's running
inside Electron. To keep it that way:

- `contextIsolation: true` — the renderer and preload run in
  separate JS contexts; nothing leaks between them.
- `nodeIntegration: false` — the renderer has no `require`,
  no `process`, no `Buffer`.
- `sandbox: true` — the preload script itself runs in a
  restricted process.
- `preload.ts` is the **only** place that touches
  `contextBridge`. It publishes a frozen, typed surface onto
  `window.alejandria`; the renderer can call the four methods
  but cannot swap implementations.
- `webContents.setWindowOpenHandler` opens every external link
  in the user's default browser (denies all `window.open` from
  inside the app).
- `webContents.on('will-navigate', …)` blocks in-app navigations
  away from the renderer URL.

## IPC channel surface

| Channel          | Renderer call                    | Main-process handler             |
|------------------|----------------------------------|----------------------------------|
| `aleja:download` | `window.alejandria.download(id)` | `downloader.download(bookId)`    |
| `aleja:sync`     | `window.alejandria.sync(dir)`    | `syncer.sync('pull'\|'push')`    |
| `aleja:scan`     | `window.alejandria.scan(path)`   | `sidecar.getProcess()` + parse   |
| `aleja:version`  | `window.alejandria.version()`    | returns versions                 |

## Sidecar contract

The Python sidecar emits a versioned JSON envelope on stdout. The
parser in `src/sidecar-client.ts` mirrors the same shape used by
`apps/web/lib/scan/local-pipeline.ts`:

```jsonc
// Success
{
  "schema_version": 1,
  "result": {
    "book_id": "…",
    "title": "…",
    "author": "…",
    "year": 1963,
    "format": "epub",
    "content_hash": "sha256:…",
    "excerpt": "…"
  }
}

// Error
{
  "schema_version": 1,
  "error": { "code": "FILE_UNREADABLE", "message": "…" }
}
```

The parser raises `SidecarEnvelopeError` (with `code` and
`sidecarMessage`) on error envelopes so the IPC layer can
propagate the failure to the renderer without losing the
sidecar's own error code.

## Test plan

- `npm test` — 26 unit tests across `preload`, `sidecar-manager`,
  `ipc-handlers`, and `sidecar-client`.
- `npm run build` — `tsc -p tsconfig.build.json` compiles
  `src/*.ts` → `dist/*.js` with no errors.
- `npm run start` — boots Electron in dev mode and loads
  `http://localhost:3001` (requires the Next.js dev server).

## Status

PR-4C scaffold. The downloader and syncer are stubs that return
`{ ok: true, transport: 'stub' }`; PR-4 will wire them to the
real implementations.
