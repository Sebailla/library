# Building & Shipping Alejandría — the macOS release pipeline

This document explains how to turn the compiled `apps/mac/dist/` into
the signed, notarised DMG that ships to end users, and how to publish
a release that `electron-updater` can ship as an in-place patch.

The build pipeline has two stages:

1. `electron-forge` turns `src/*.ts` into a runnable mac app
   (scaffold already in PR-4C, see `apps/mac/forge.config.ts`).
2. `electron-builder` wraps that app in a DMG, codesigns it,
   notarises it through Apple's notary service, and writes the
   update manifest (`latest-mac.yml`) that the running app
   consults on every launch. The config lives in
   `apps/mac/electron-builder.yml`.

```
        ┌────────────────────┐
        │ npm run build      │   tsc -p tsconfig.build.json
        └─────────┬──────────┘
                  ▼
        ┌────────────────────┐
        │ npm run package    │   electron-forge package
        │   → out/Alejandría │   plain, unsigned .app
        └─────────┬──────────┘
                  ▼
        ┌────────────────────┐
        │ npm run dist       │   electron-builder --mac
        │   → release/       │   DMG + latest-mac.yml (update
        │                    │   manifest)
        └─────────┬──────────┘
                  ▼
        ┌────────────────────┐
        │ ./scripts/verify-  │   smoke test: bundle id,
        │   dist.cjs         │   CFBundleName, executable
        └─────────┬──────────┘
                  ▼
        ┌────────────────────┐
        │ gh release create  │   upload DMG + latest-mac.yml
        └────────────────────┘
```

## Prerequisites (one-time setup)

1. **Apple Developer account** with a paid program membership
   ($99/yr). Codesigning + notarisation both require it.
2. **Developer ID Application** certificate installed in your
   login Keychain. Generate it from
   <https://developer.apple.com/account/resources/certificates/list>.
3. **App-specific password** for `notarytool`. Generate one from
   <https://appleid.apple.com/account/manage> → "App-Specific
   Passwords".
4. `electron-builder` installed as a dev dep:

   ```sh
   cd apps/mac
   npm install --save-dev electron-builder
   ```

5. CLI helper for building only the macOS artefacts:

   ```jsonc
   // apps/mac/package.json — add this under "scripts"
   "dist": "electron-builder --mac --config electron-builder.yml",
   "dist:unsigned": "electron-builder --mac --config electron-builder.yml --publish never"
   ```

## Build & verify (every release)

```sh
# 1. Compile the Electron main process
cd apps/mac
npm run build

# 2. Wrap it in a macOS .app via electron-forge
npm run package

# 3. Wrap that in a DMG via electron-builder (codesign + notarize)
CSC_LINK=/path/to/DeveloperID.p12 \
CSC_KEY_PASSWORD='…' \
APPLE_ID='you@example.com' \
APPLE_APP_SPECIFIC_PASSWORD='abcd-efgh-ijkl-mnop' \
APPLE_TEAM_ID='ABCDE12345' \
  npm run dist

# 4. Smoke test the artefact
node scripts/verify-dist.cjs ./release
```

`verify-dist.cjs` exits non-zero if `release/Alejandria.app` is
missing, has the wrong `CFBundleIdentifier`, or is missing the
`MacOS/alejandria` executable. CI runs it after every `dist`.

## Codesigning details

`electron-builder` picks the signing identity from your Keychain
automatically when you set `CSC_LINK` to a path containing the
Developer ID Application certificate (`p12` format). The
exposed env vars are:

| Var | What | Required |
|-----|------|----------|
| `CSC_LINK` | Path to the `.p12` certificate | Yes (local) — CI uses secrets instead |
| `CSC_KEY_PASSWORD` | The p12's password | Yes when `CSC_LINK` is set |
| `CSC_NAME` | The certificate's *common name* (e.g. `Developer ID Application: Sebailla (ABCDE12345)`) | Optional; pick from Keychain if multiple are installed |
| `APPLE_ID` | Apple ID email used for notarisation | Yes |
| `APPLE_APP_SPECIFIC_PASSWORD` | The app-specific password (see step 3 above) | Yes |
| `APPLE_TEAM_ID` | 10-character team identifier | Yes |

The `hardenedRuntime: true` flag in `electron-builder.yml`
turns on the macOS Hardened Runtime, which notarisation
*requires*. Don't disable it.

## Auto-update flow (`electron-updater`)

`apps/mac/electron-builder.yml` declares the publish target:

```yaml
publish:
  provider: github
  owner: Sebailla
  repo: library
  releaseType: release
```

Every time `npm run dist` succeeds, electron-builder uploads
`release/Alejandria-X.Y.Z.dmg` + `release/latest-mac.yml` as a
GitHub release of the form `vX.Y.Z`. The YAML manifest is the
channel the running app consults on launch:

```
GET https://github.com/Sebailla/library/releases/latest/download/latest-mac.yml
```

If the running version is older than the manifest version,
`electron-updater` downloads the DMG, runs `hdiutil attach` to
extract the new `.app`, and swaps it in on the next launch. The
user never has to drag a fresh DMG to `/Applications/` again.

### Cutting a release

```sh
# Bump the version in apps/mac/package.json AND packages/mac/manifest.json
# (whichever the team standardises on — keep them in lock-step).
git tag v0.2.0
git push origin v0.2.0

# CI: on tag push, the macOS release workflow runs:
#   1. npm ci
#   2. npm run build
#   3. npm run dist          (with CSC_LINK et al. from GitHub secrets)
#   4. node scripts/verify-dist.cjs
#   5. gh release upload      (attaches the DMG to the existing tag)
```

If the release workflow is NOT yet wired, you can publish from
your laptop:

```sh
cd apps/mac
npm run dist
gh release create v0.2.0 \
  release/Alejandría-0.2.0-arm64.dmg \
  release/Alejandría-0.2.0.dmg \
  release/latest-mac.yml
```

## CI configuration (placeholder)

The macOS release workflow lives at
`.github/workflows/release-mac.yml` (added in PR-5). Required
secrets:

- `CSC_LINK` — base64-encoded `DeveloperID.p12`.
- `CSC_KEY_PASSWORD` — the p12 password.
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` — as above.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `electron-builder` can't find a signing identity | Cert not imported into Keychain, or `CSC_NAME` doesn't match | Re-import the p12, list certs with `security find-identity -p codesigning -v` |
| `notarytool` returns "Could not find app-specific password" | `APPLE_APP_SPECIFIC_PASSWORD` not set or wrong scope | Regenerate the password on appleid.apple.com; the account email MUST match `APPLE_ID` |
| DMG installs fine but auto-update never fires | `latest-mac.yml` not on the release, or under a different tag | Compare `gh release view v0.X.Y --json assets` output to the manifest URL above |
| `verify-dist.cjs` reports `CFBundleIdentifier` mismatch | `forge.config.ts` and `electron-builder.yml` drifted apart | Keep `appBundleId`/`appId` in sync |
| DMG is huge (~250 MB) | Forgot to mark native deps as external | Add `asarUnpack` to `electron-builder.yml` |
