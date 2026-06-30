/**
 * Auto-updater wiring for the `@alejandria/mac` Electron shell
 * (PR-N8, issue #94).
 *
 * The renderer surfaces a "Update ready to install" chip when
 * electron-updater finds a newer manifest. Two concerns:
 *
 *   1. The bearer token (`GH_TOKEN`) MUST be read from
 *      `process.env` at call time, not at module load. CI rotates
 *      the secret on every build; baking it into the module
 *      would force a restart between secrets.
 *
 *   2. The dev shell MUST never call out to GitHub. We detect
 *      `app.isPackaged === false` and substitute a no-op updater
 *      that rejects `checkForUpdates()` with a descriptive error.
 *
 * The module wraps `electron-updater` so the import is optional —
 * tests can stub it without spinning up a full Electron runtime.
 */

type Logger = { transports: { file: { level: string } } }
type AutoUpdaterShape = {
  auth: string | null
  autoDownload: boolean
  channel: string | null
  checkForUpdates(): Promise<unknown>
  setFeedURL(config: Record<string, unknown>): void
  logger: Logger
  on(event: string, cb: (...args: unknown[]) => void): unknown
}

interface ElectronAppShape {
  isPackaged: boolean
  getVersion(): string
}

interface ElectronModuleShape {
  app: ElectronAppShape
}

interface UpdaterModule {
  autoUpdater: AutoUpdaterShape
}

interface UpdaterBridge {
  checkForUpdates(): Promise<unknown>
  on(event: string, listener: (...args: unknown[]) => void): void
}

/**
 * Configure the auto-updater:
 *
 *   - copy `process.env.GH_TOKEN` onto `autoUpdater.auth` (read at
 *     call time so CI can rotate the secret between invocations);
 *   - copy `process.env.ALEJANDRIA_UPDATE_CHANNEL` onto
 *     `autoUpdater.channel` (default `'stable'`);
 *   - set the GitHub feed URL via `setFeedURL` so the updater
 *     targets `Sebailla/library`;
 *   - downgrade `autoDownload` to `false` in dev so a developer's
 *     shell does not silently fetch newer binaries.
 *
 * The function is a no-op (returns void) for the dev shell — the
 * renderer is wired through {@link createNoopUpdater} instead.
 */
export async function configureUpdater(): Promise<void> {
  const { autoUpdater } = await importUpdater()
  const electron = await importElectron()

  const token = process.env['GH_TOKEN'] ?? null
  autoUpdater.auth = token

  const channel = process.env['ALEJANDRIA_UPDATE_CHANNEL'] ?? 'stable'
  autoUpdater.channel = channel

  // GitHub Releases feed — mirrors `electron-builder.yml → publish`.
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'Sebailla',
    repo: 'library',
    releaseType: 'release',
  })

  // Stamp logs so a CI failure is correlatable to the build number.
  try {
    autoUpdater.logger.transports.file.level = electron.app.isPackaged ? 'info' : 'warn'
  } catch {
    /* logger may not be configured in tests */
  }

  autoUpdater.autoDownload = false
}

/**
 * Build a no-op updater for the dev shell. `checkForUpdates()`
 * rejects so the renderer's "Check for updates" button surfaces an
 * error instead of hanging on a network request that the package
 * does not exist on.
 */
export function createNoopUpdater(): UpdaterBridge {
  return {
    async checkForUpdates(): Promise<unknown> {
      throw new Error('updater disabled in dev (app.isPackaged === false)')
    },
    on() {
      /* no-op */
    },
  }
}

/**
 * Build a real updater wired through `configureUpdater`. Used by
 * `main.ts` after the window is ready.
 */
export async function createUpdater(): Promise<UpdaterBridge> {
  const electron = await importElectron()
  if (!electron.app.isPackaged) {
    return createNoopUpdater()
  }
  const { autoUpdater } = await importUpdater()
  await configureUpdater()
  return {
    async checkForUpdates(): Promise<unknown> {
      return autoUpdater.checkForUpdates()
    },
    on(event: string, listener: (...args: unknown[]) => void): void {
      autoUpdater.on(event, listener)
    },
  }
}

async function importUpdater(): Promise<UpdaterModule> {
  // Dynamic ESM import — vitest's `vi.mock('electron-updater')`
  // hooks this path so tests can substitute a fake without
  // importing the real package (which initializes a singleton
  // against `electron.app` at module load and refuses to load
  // outside an Electron runtime).
  const m = (await import('electron-updater')) as unknown as
    | UpdaterModule
    | { default: UpdaterModule }
  if ('default' in (m as { default: UpdaterModule })) {
    return (m as { default: UpdaterModule }).default
  }
  return m as UpdaterModule
}

async function importElectron(): Promise<ElectronModuleShape> {
  const m = (await import('electron')) as unknown as ElectronModuleShape
  return m
}
