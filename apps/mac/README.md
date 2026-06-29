# `@alejandria/mac`

Electron 33 shell for the alejandria-v2 macOS app (PR-4C scaffold,
PR-4D production build).

This package hosts the Next.js web UI in a native window, exposes a
`window.alejandria` IPC bridge to the renderer, and supervises the
Python sidecar process. It is the desktop counterpart to the
`apps/web` Next.js dev server.

## For end users — installing and running Alejandría

If you downloaded the DMG from a release (e.g.
`https://github.com/Sebailla/library/releases`), the rest of this
section is for you.

### Install

1. Open the DMG (`Alejandría-X.Y.Z.dmg`) you downloaded.
2. **Drag the `Alejandría` icon into the `Applications` shortcut.**
3. The DMG asks you to confirm; click "Replace" if you already had
   an older version installed.
4. Eject the DMG.

### First run

macOS Gatekeeper will block the first launch because the app is
signed with a **Developer ID Application** certificate (not the
Mac App Store). Two ways through it:

- **Right-click the app** in `/Applications/` and choose
  `Open`. Confirm the warning dialog the first time. Subsequent
  launches behave normally.
- Or go to `System Settings → Privacy & Security`, scroll to the
  bottom, and click `Open Anyway` next to the message about
  `Alejandría` being blocked. Then launch normally.

After the first launch the app registers the `app://` deep-link
scheme; you can now close the warning and start reading.

### Pairing with the NAS

The first time the app opens it walks you through the NAS pairing:

1. Pick `Pair with NAS…` from the top-level menu.
2. Enter the `nas://...` invite code your NAS admin sent you (see
   `services/nas-backend/README.md` for the operator flow).
3. The app stores the credentials in the system Keychain (NOT in
   plain text). To audit or revoke, open `Keychain Access` and
   search for `Alejandría`.

After pairing, the app can pull and push your library by tapping
the `Sync now` button on the home screen.

### Where your data lives

| What | Where on disk |
|------|---------------|
| Local library cache (book metadata, covers) | `~/Library/Application Support/alejandria/library.sqlite` |
| Downloaded book files | `~/Library/Application Support/alejandria/books/` |
| Sidecar logs (Python process) | `~/Library/Logs/alejandria/sidecar.log` |
| iCloud-synced annotations + read state | `~/Library/Mobile Documents/iCloud~com~alejandria~app/` |

### iCloud sync

If you sign in with the Apple ID that owns the Mac (and have iCloud
Drive enabled), `read positions`, `highlights`, `notes`, and
`shelf state` are mirrored to the `Alejandría` folder in iCloud
Drive. Other Apple devices that pick up the same iCloud account
will see the metadata within ~30 seconds. **Book files themselves
never enter iCloud — only the metadata.**

To toggle iCloud sync:

```
Settings → Sync → iCloud Drive (toggle on/off)
```

Disabling it keeps existing local data but stops future
synchronisation. Re-enabling it merges any drift your devices
accumulated while sync was off.

### Updating

The app uses `electron-updater`. On every launch it consults
`https://github.com/Sebailla/library/releases/latest/download/latest-mac.yml`
and downloads the next DMG in the background. You'll see a small
`Update ready to install` chip in the top-right corner — click it
to relaunch with the new version.

If your machine is offline or the publish is not signed, you can
update manually by repeating the Install steps.

### Uninstall

```
rm -rf "/Applications/Alejandría.app"
rm -rf ~/Library/Application\ Support/alejandria
rm -rf ~/Library/Logs/alejandria
# iCloud data lives in the system Drive folder — use the Finder to remove
# the `Alejandría` subdirectory if you want a full wipe.
```

The next launch will pick up new pairing credentials again.

## For contributors — architecture and scripts

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
| `npm test`         | Run the vitest unit suite (40 tests across 7 files).        |
| `npm run typecheck`| `tsc --noEmit` against the full tsconfig.                   |
| `npm run build`    | Compile `src/*.ts` into `dist/*.js` (electron-forge input). |
| `npm run dev`      | Boot Electron in dev mode (loads `http://localhost:3001`).  |
| `npm run start`    | Same as `dev` (alias).                                      |
| `npm run package`  | `electron-forge package` — produce an unsigned mac build.   |
| `npm run make`     | `electron-forge make` — produce a DMG + ZIP artefact.       |
| `npm run dist`     | `electron-builder --mac` — produce a codesigned, notarised DMG (see `BUILD.md`). |

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

- `npm test` — 40 unit tests across `preload`, `sidecar-manager`,
  `ipc-handlers`, `sidecar-client`, `electron-builder`,
  `npmrc`, and `verify-dist`.
- `npm run build` — `tsc -p tsconfig.build.json` compiles
  `src/*.ts` → `dist/*.js` with no errors.
- `npm run start` — boots Electron in dev mode and loads
  `http://localhost:3001` (requires the Next.js dev server).
- `node apps/mac/scripts/verify-dist.cjs` — smoke-tests the built
  `.app` after `npm run make` (run from the repo root).

See `BUILD.md` at the repository root for the full release flow
(codesign + notarise + publish to GitHub Releases + auto-update).

## Status

PR-4D scaffold. The downloader and syncer are stubs that return
`{ ok: true, transport: 'stub' }`; a future PR will wire them to
the real implementations. The codesign + notarise pipeline is
documented but not yet run end-to-end on a runner.
