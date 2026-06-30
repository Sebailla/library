import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * TDD tests for `apps/mac/scripts/sign-and-notarize.sh` (PR-N8).
 *
 * Scope: the codesign + notarize flow. The shell script is a thin
 * wrapper over `electron-builder --mac` that:
 *
 *   - refuses to run unless the four mandatory env vars are set
 *     (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`,
 *     `CSC_LINK`).
 *   - calls `electron-builder --mac --publish never` so the CI runner
 *     can invoke it without `GH_TOKEN`.
 *   - waits on `xcrun notarytool submit --wait` for the notarization
 *     ticket (the BLOCKING `--wait` flag is the whole point of this
 *     PR — without it the build claims success before Apple has
 *     actually approved the binary, which has shipped broken builds
 *     in this project before).
 *
 * The test does NOT shell out to the script (CI is OS-portable);
 * it asserts on the script's contents statically.
 */

const SCRIPT_PATH = resolve(__dirname, '../scripts/sign-and-notarize.sh')

function readScript(): string {
  return readFileSync(SCRIPT_PATH, 'utf8')
}

describe('sign-and-notarize.sh (PR-N8, codesign + notarytool --wait)', () => {
  it('exists and is not empty', () => {
    const body = readScript()
    expect(body.length).toBeGreaterThan(0)
  })

  it('defines a shebang so `node scripts/...sh` (chmod +x) works on macOS runners', () => {
    const body = readScript()
    expect(body.startsWith('#!/usr/bin/env bash')).toBe(true)
  })

  it('refuses to run when mandatory Apple env vars are missing', () => {
    const body = readScript()
    expect(body).toMatch(/APPLE_ID/)
    expect(body).toMatch(/APPLE_APP_SPECIFIC_PASSWORD/)
    expect(body).toMatch(/APPLE_TEAM_ID/)
    expect(body).toMatch(/CSC_LINK/)
    // Each guard ends with `exit 1` so the caller can detect the refusal.
    const guards = body.match(/exit 1/g) ?? []
    expect(guards.length).toBeGreaterThanOrEqual(1)
  })

  it('invokes electron-builder with --publish never so it never tries GitHub releases', () => {
    const body = readScript()
    expect(body).toMatch(/electron-builder/)
    expect(body).toMatch(/--publish[\s=]+never/)
  })

  it('waits on `notarytool submit --wait` instead of fire-and-forget', () => {
    const body = readScript()
    expect(body).toMatch(/xcrun[\s\n]+notarytool[\s\n]+submit/)
    expect(body).toMatch(/--wait/)
  })

  it('maps the env var `ELECTRON_BUILDER_CACHE` to electron-builder\'s cache dir', () => {
    // Optional — but the canonical production flow depends on
    // ELECTRON_BUILDER_CACHE pointing at a writable path on the
    // runner, so the script SHOULD honour it.
    const body = readScript()
    expect(body).toMatch(/ELECTRON_BUILDER_CACHE/)
  })
})
