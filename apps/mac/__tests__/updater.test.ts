import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * TDD tests for `src/updater.ts` (PR-N8, issue #94).
 *
 * Scope: `electron-updater` needs a `GH_TOKEN` to publish / query a
 * private repository. We wire the token through `process.env.GH_TOKEN`
 * so the build pipeline does NOT have to hardcode credentials, and
 * so the dev shell degrades gracefully when no token is configured
 * (`checkForUpdates()` no-ops, no network call).
 *
 * The updater module MUST:
 *
 *   1. Read `process.env.GH_TOKEN` at call time (NOT at module load),
 *      so CI can rotate the secret without restarting the shell.
 *   2. Map the env var onto `autoUpdater.auth` so the official
 *      `electron-updater` consumes it without further config.
 *   3. Skeleton wiring surfaces the same shape even when
 *      electron-updater is unavailable (the import is wrapped so
 *      the module can be unit-tested in plain Node).
 *   4. Expose a `noOp()` updater fallback for the dev shell.
 */

const capturedAuth: {
  token: string | null
  updateConfigPath: string | null
  feedConfig: Record<string, unknown> | null
} = {
  token: null,
  updateConfigPath: null,
  feedConfig: null,
}

interface FakeUpdater {
  auth: string | null
  autoDownload: boolean
  channel: string | null
  checkForUpdates: () => Promise<unknown>
  setFeedURL: (cfg: Record<string, unknown>) => void
  logger: { transports: { file: { level: string } } }
  on: (event: string, cb: (...args: unknown[]) => void) => unknown
}

const fakeUpdater: FakeUpdater = {
  auth: null,
  autoDownload: false,
  channel: null,
  async checkForUpdates() {
    return null
  },
  setFeedURL(cfg) {
    capturedAuth.feedConfig = cfg
    capturedAuth.updateConfigPath = (cfg['url'] as string | undefined) ?? `github://${String(cfg['owner'] ?? '')}/${String(cfg['repo'] ?? '')}`
  },
  logger: { transports: { file: { level: 'info' } } },
  on() {
    return undefined
  },
}

// Build a fake electron module — kept inline so the mock can run
// before the import under test. The shape covers `app.isPackaged`
// + `app.getVersion()` because electron-updater's `ElectronAppAdapter`
// reads both.
const electronModuleMock = {
  app: {
    isPackaged: false,
    getVersion: () => '0.1.0-test',
  },
}

vi.mock('electron-updater', () => {
  return {
    default: { autoUpdater: fakeUpdater },
    autoUpdater: fakeUpdater,
  }
})

vi.mock('electron', () => electronModuleMock)

describe('updater (PR-N8, env-driven GH_TOKEN)', () => {
  beforeEach(() => {
    capturedAuth.token = null
    capturedAuth.updateConfigPath = null
    capturedAuth.feedConfig = null
    fakeUpdater.auth = null
    fakeUpdater.channel = null
    fakeUpdater.autoDownload = false
    delete process.env['GH_TOKEN']
    delete process.env['ALEJANDRIA_UPDATE_CHANNEL']
  })

  it('configureUpdater() reads GH_TOKEN from process.env at call time', async () => {
    process.env['GH_TOKEN'] = 'ghp_secret_123'
    const { configureUpdater } = await import('../src/updater')

    await configureUpdater()

    // Two distinct reads because the production code copies the env
    // value onto `autoUpdater.auth` AND has a side channel for the
    // test harness to spot-check the URL it was told to fetch.
    expect(capturedAuth.updateConfigPath).not.toBeNull()
    expect(fakeUpdater.auth).toBe('ghp_secret_123')
  })

  it('configureUpdater() leaves auth unset and skips the network call when GH_TOKEN is missing', async () => {
    const spy = vi.spyOn(fakeUpdater, 'checkForUpdates')
    const { configureUpdater } = await import('../src/updater')

    await configureUpdater()

    expect(fakeUpdater.auth).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('configureUpdater() selects the "stable" channel unless ALEJANDRIA_UPDATE_CHANNEL overrides', async () => {
    const { configureUpdater } = await import('../src/updater')

    await configureUpdater()
    expect(fakeUpdater.channel).toBe('stable')

    fakeUpdater.channel = null
    process.env['ALEJANDRIA_UPDATE_CHANNEL'] = 'beta'
    await configureUpdater()
    expect(fakeUpdater.channel).toBe('beta')
  })

  it('createNoopUpdater() returns an updater whose checkForUpdates() rejects in dev', async () => {
    electronModuleMock.app.isPackaged = false
    const { createNoopUpdater } = await import('../src/updater')
    const updater = createNoopUpdater()
    expect(typeof updater.checkForUpdates).toBe('function')
    await expect(updater.checkForUpdates()).rejects.toThrow(/dev|packaged/i)
  })
})
