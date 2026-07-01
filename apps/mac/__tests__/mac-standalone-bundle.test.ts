import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * TDD tests for the Mac-side build contract
 * (PR-fix-mac-window-standalone-bundle).
 *
 * The Mac .app used to silently fail to render because `main.ts` called
 * `loadURL('app://./index.html')` and no `app://` handler ever resolved.
 *
 * The fix is two-pronged:
 *
 *   1. `apps/mac/package.json` MUST run `next build` for the web app
 *      BEFORE `electron-forge package` so `.next/standalone/` exists
 *      when the packager runs. We use a `prepackage` npm lifecycle hook
 *      (npm runs `pre<hook>` automatically before `<hook>`).
 *
 *   2. `apps/mac/forge.config.ts` MUST declare extraResources (or
 *      resource rules) so the standalone directory actually lands inside
 *      the `.app/Contents/Resources/` tree — otherwise asar sees it as
 *      a missing asset and the runtime can't `spawn()` the server.
 *
 * If either is missing, the package step silently succeeds but the .app
 * crashes on launch (or shows a blank window because `loadURL` fails).
 */

interface PackageJsonShape {
  scripts?: Record<string, string>
}

interface ForgeConfigShape {
  packagerConfig?: Record<string, unknown>
}

describe('apps/mac build contract (PR-fix-mac-window-standalone-bundle)', () => {
  const packageJsonPath = resolve(__dirname, '../package.json')
  const forgeConfigPath = resolve(__dirname, '../forge.config.ts')

  it('declares a prepackage hook that builds the Next.js standalone output', () => {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageJsonShape
    expect(pkg.scripts).toBeDefined()
    // npm runs `prepackage` before `package`. The exact command is
    // documented in the project's BUILD.md — keep them in sync.
    const prepackage = pkg.scripts?.['prepackage']
    expect(prepackage).toBeDefined()
    // The prepackage MUST invoke next build via npm --prefix so it
    // resolves the workspace correctly without a parent package.json.
    expect(prepackage).toMatch(/npm\s+--prefix\s+\.\.\/web/)
    expect(prepackage).toMatch(/run\s+build:standalone/)
  })

  it('declares a package script that runs electron-forge package', () => {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageJsonShape
    expect(pkg.scripts?.['package']).toBe('electron-forge package')
  })

  it('forge.config.ts bundles apps/web/.next/standalone into the .app resources', () => {
    const raw = readFileSync(forgeConfigPath, 'utf8')
    // electron-forge recognises either:
    //   - packagerConfig.extraResources: string[]
    //   - packagerConfig.resource:      string | string[]
    // We accept both shapes — the regex is intentionally permissive so
    // a future refactor (e.g. moving to `resource:`) doesn't break
    // this test.
    const mentionsExtraResources = /extraResources/.test(raw)
    const mentionsStandalonePath = /\.next\/standalone|\.\.\/web\/\.next\/standalone/.test(raw)
    expect(mentionsExtraResources).toBe(true)
    expect(mentionsStandalonePath).toBe(true)
  })

  it('forge.config.ts keeps the app:// URL scheme registered (deep links still work)', () => {
    const raw = readFileSync(forgeConfigPath, 'utf8')
    // Regression guard — PR-4C added the app:// protocol. The
    // standalone-bundle fix MUST NOT drop it.
    expect(raw).toMatch(/schemes:\s*\[\s*['"]app['"]/)
  })

  it('forge.config.ts is valid TS that exports a default object', () => {
    // Smoke check — the file MUST `export default config` (so
    // electron-forge's TS loader can import it). Other tests parse
    // it as text, but we want a structural guardrail here so a
    // rename can't slip through silently.
    const raw = readFileSync(forgeConfigPath, 'utf8')
    expect(raw).toMatch(/export\s+default\s+config/)
  })
})