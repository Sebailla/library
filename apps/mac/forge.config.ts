/**
 * electron-forge configuration for `@alejandria/mac` (PR-4C;
 * PR-fix-mac-window-standalone-bundle).
 *
 * Two packaging targets:
 *   1. `zip`  — every CI run produces a zipped mac build so
 *               testers can grab a fresh artefact.
 *   2. `dmg`  — the user-facing installer. The maker is only
 *               registered for `darwin` (the only platform this
 *               app ships on) and only when packaging (not when
 *               running `electron-forge start`).
 *
 * Auto-update is wired through `electron-updater` (declared as
 * a runtime dependency in `package.json`) so future releases
 * can ship without forcing the user to redownload the DMG
 * manually.
 *
 * The `app://` URL scheme registered here is what `main.ts`
 * loads in production (see `rendererUrl()` in main.ts).
 *
 * The `extraResources` entry ships the Next.js standalone server
 * (built by the `prepackage` npm hook in `package.json`) inside
 * `.app/Contents/Resources/standalone/`. The runtime reads it
 * via `path.join(process.resourcesPath, 'standalone')` and
 * spawns `node server.js` (see `apps/mac/src/standalone-server.ts`).
 *
 * Note: the build pipeline uses plain `tsc` (see
 * `tsconfig.build.json`) rather than the Vite plugin. The
 * scaffold keeps the build chain to one tool so the test/build
 * loop stays tight; a future PR can swap in the Vite plugin
 * once the build artefacts have stabilised.
 */

import type { ForgeConfig } from '@electron-forge/shared-types'
import { MakerZIP } from '@electron-forge/maker-zip'
import { MakerDMG } from '@electron-forge/maker-dmg'
import { PublisherGithub } from '@electron-forge/publisher-github'

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: 'Alejandría',
    executableName: 'alejandria',
    appBundleId: 'com.alejandria.app',
    appCategoryType: 'public.app-category.education',
    // Custom app icon — stylised open book on warm parchment. The path
    // is relative to this file (apps/mac/) and points at the .icns that
    // `scripts/generate-icon.py` regenerates. Both electron-forge and
    // electron-builder consume the same .icns so a designer can swap
    // build-resources/icon.png once and rebuild both targets.
    icon: 'build-resources/icon.icns',
    protocols: [
      {
        name: 'alejandria',
        schemes: ['app'],
      },
    ],
    // Bundle the Next.js standalone server inside the .app so the
    // main process can spawn it as a child process. The prepackage
    // hook (in package.json) copies the standalone output from
    // ../web/.next/standalone into standalone/ so the packager
    // can find it with a relative path.
    // Note: @electron/packager v18 uses `extraResource` (singular,
    // string | string[]) for plain directory copies, NOT the
    // `extraResources` (plural, {from,to}[]) syntax that some docs
    // reference. The destination is `Resources/<basename(path)>`,
    // so `standalone/` ends up at `Resources/standalone/`.
    extraResource: ['standalone'],
  },
  rebuildConfig: {},
  makers: [
    new MakerZIP({}, ['darwin']),
    new MakerDMG(
      {
        name: 'Alejandría',
        overwrite: true,
      },
      ['darwin'],
    ),
  ],
  publishers: [
    new PublisherGithub({
      repository: {
        owner: 'Sebailla',
        name: 'library',
      },
      prerelease: false,
    }),
  ],
}

export default config
