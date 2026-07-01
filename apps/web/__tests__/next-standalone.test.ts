import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * TDD tests for `apps/web/next.config.ts` (PR-fix-mac-window-standalone-bundle).
 *
 * The Mac .app used to silently fail to render because `main.ts` called
 * `loadURL('app://./index.html')` and the Next.js app was never bundled.
 *
 * The fix wires the Mac .app to spawn the **Next.js standalone server**
 * as a child process. Standalone output is the only Next.js build mode
 * that produces a self-contained Node server in `.next/standalone/`
 * (it inlines the minimal `node_modules` the server needs).
 *
 * If `output: 'standalone'` is missing, the build will succeed but the
 * .next/standalone directory will not exist and the Mac prepackage
 * hook will silently copy nothing — and the .app will keep failing to
 * render in production.
 */

describe('apps/web/next.config.ts (standalone output contract)', () => {
  const configPath = resolve(__dirname, '../next.config.ts')
  const packagePath = resolve(__dirname, '../package.json')

  it('exists at apps/web/next.config.ts', () => {
    expect(existsSync(configPath)).toBe(true)
  })

  it('declares output: "standalone" so next build produces .next/standalone/', () => {
    const raw = readFileSync(configPath, 'utf8')
    // Match `output: 'standalone'` or `output: "standalone"`. We
    // deliberately do NOT parse the TS file (no TS loader in this
    // test suite); a regex on the source is enough — the project
    // uses single quotes for the property value.
    expect(raw).toMatch(/output:\s*['"]standalone['"]/)
  })

  it('declares a build:standalone script in package.json (so the Mac prepackage hook can call it)', () => {
    const pkg = JSON.parse(readFileSync(packagePath, 'utf8')) as {
      scripts?: Record<string, string>
    }
    expect(pkg.scripts).toBeDefined()
    expect(pkg.scripts?.['build:standalone']).toBe('next build')
  })

  it('keeps cacheComponents: true (PR-3A regression guard)', () => {
    const raw = readFileSync(configPath, 'utf8')
    expect(raw).toMatch(/cacheComponents:\s*true/)
  })
})