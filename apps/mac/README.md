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

## Building a distributable

The Mac app can be packaged in three ways. Pick the one that matches
your release goal.

### 1. Quick zip (no codesign, dev/testing)

```bash
cd apps/mac
npm install
npm run package
# Produces out/make/Alejandría-darwin-*/Alejandría.app/Contents/MacOS/alejandria
# Plus out/make/Alejandría-darwin-x64.zip
```

### 2. Unsigned .dmg (dev/testing)

```bash
cd apps/mac
npm install
npm run dist:mac:unsigned
# Produces out/Alejandría-0.1.0.dmg (or version-appropriate)
```

### 3. Codesigned + notarized .dmg (production)

```bash
# Set credentials (see BUILD.md for full env vars)
export MACOS_CODESIGN_IDENTITY="Developer ID Application: Sebailla (XXXXXXXXXX)"
export APPLE_ID="sebailla@example.com"
export APPLE_ID_PASSWORD="abcd-efgh-ijkl-mnop"
export APPLE_TEAM_ID="XXXXXXXXXX"

cd apps/mac
npm run dist:mac:sign
# Produces out/Alejandría-0.1.0.dmg, codesigned and notarized
```

### Installing the app

After producing the .dmg:

1. Open the .dmg (double-click in Finder)
2. Drag `Alejandría.app` to `/Applications`
3. Eject the .dmg
4. Open the app from `/Applications` (or Launchpad)

The custom icon (a stylised open book on warm parchment) will appear
in Finder, Dock, and Launchpad.

## Updating the app icon

1. Edit `apps/mac/build-resources/icon.png` (any image editor, 1024x1024 min)
2. Run `python3 apps/mac/scripts/generate-icon.py` to regenerate the .icns + iconset
3. Re-run `npm run package` or `npm run dist:mac:unsigned`

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
| `npm test`         | Run the vitest unit + integration suite (64 tests across 12 files). |
| `npm run typecheck`| `tsc --noEmit` against the full tsconfig.                   |
| `npm run build`    | Compile `src/*.ts` into `dist/*.js` (electron-forge input). |
| `npm run dev`      | Boot Electron in dev mode (loads `http://localhost:3001`).  |
| `npm run start`    | Same as `dev` (alias).                                      |
| `npm run package`  | `electron-forge package` — produce an unsigned mac build.   |
| `npm run make`     | `electron-forge make` — produce a DMG + ZIP artefact.       |
| `npm run dist`     | `electron-builder --mac` — produce a codesigned, notarised DMG (see `BUILD.md`). |
| `npm run dist:mac:sign`  | `apps/mac/scripts/sign-and-notarize.sh` — production codesign + `notarytool submit --wait`. |
| `npm run dist:mac:unsigned` | `electron-builder --mac … --publish never` — codesign + DMG without hitting GitHub Releases. |

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

- `npm test` — vitest unit + integration suite (64 tests across
  `preload`, `sidecar-manager`, `ipc-handlers`, `sidecar-client`,
  `electron-builder`, `npmrc`, `verify-dist`, `downloader`,
  `syncer`, `sidecar.end-to-end`, `updater`, and
  `sign-and-notarize`).
- `npm run build` — `tsc -p tsconfig.build.json` compiles
  `src/*.ts` → `dist/*.js` with no errors.
- `npm run start` — boots Electron in dev mode and loads
  `http://localhost:3001` (requires the Next.js dev server).
- `node apps/mac/scripts/verify-dist.cjs` — smoke-tests the built
  `.app` after `npm run make` (run from the repo root).

See `BUILD.md` at the repository root for the full release flow
(codesign + notarise + publish to GitHub Releases + auto-update).

## Status

PR-N8 — real IPC integrations. The downloader (`src/downloader.ts`)
hits the NAS over native `fetch` against the four endpoints used by
`apps/web` (`listBooks`, `startDownload`, `downloadFile`,
`completeDownload`). The syncer (`src/syncer.ts`) watches the
bundled `iCloud~com~alejandria~app/` directory via chokidar, with
`pull()` reading the directory at startup and `change` events
fired on every write. The auto-updater (`src/updater.ts`) reads
`process.env.GH_TOKEN` at call time so CI can rotate the secret
between invocations, and falls back to a no-op when
`app.isPackaged === false`. The codesign + notarize shell script
(`scripts/sign-and-notarize.sh`) uses `xcrun notarytool submit --wait`
so the script only returns 0 after Apple has stamped the binary.
