import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * TDD tests for `apps/mac/.npmrc` (PR-4D, issue #77).
 *
 * electron-builder pulls in a transitive dep that, with
 * `legacy-peer-deps=true`, breaks `electron-store` resolution
 * during codesign. The workaround is `legacy-peer-deps=false`
 * paired with `strict-peer-dependencies=false` — both keys
 * must be present and well-formed so `npm install` in CI and
 * locally produces the same `package-lock.json` shape.
 */

describe('.npmrc (PR-4D)', () => {
  const npmrcPath = resolve(__dirname, '../.npmrc')

  it('exists at apps/mac/.npmrc', () => {
    expect(existsSync(npmrcPath)).toBe(true)
  })

  it('disables legacy-peer-deps so electron-builder resolves cleanly', () => {
    const raw = readFileSync(npmrcPath, 'utf8')
    const lines = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
    expect(lines).toContain('legacy-peer-deps=false')
  })

  it('does not require strict peer-dependencies (electron-builder quirk)', () => {
    const raw = readFileSync(npmrcPath, 'utf8')
    const lines = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
    expect(lines).toContain('strict-peer-dependencies=false')
  })
})
