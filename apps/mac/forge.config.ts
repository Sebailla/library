/**
 * electron-forge configuration for `@alejandria/mac` (PR-4C).
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
    // The icon will be added in a follow-up PR (PR-4D). For now
    // we let electron-forge pick the default.
    protocols: [
      {
        name: 'alejandria',
        schemes: ['app'],
      },
    ],
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
