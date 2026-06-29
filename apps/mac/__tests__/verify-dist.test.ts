import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * TDD tests for `apps/mac/scripts/verify-dist.cjs` (PR-4D, issue #77).
 *
 * electron-builder --mac (and the existing `npm run make`) puts the
 * user-facing artefact under out/make/zip/darwin/ or release/. The
 * `verify-dist` smoke test is the canary that runs after every build
 * to confirm:
 *
 *   1. The .app bundle exists at the expected path.
 *   2. The Info.plist exists with the production bundle id
 *      (`com.alejandria.app`) so future codesign / notarize passes
 *      find the same identity.
 *   3. The CFBundleName matches the user-facing product name.
 *   4. The CFBundleExecutable matches the `package.json` `executableName`
 *      declared in `forge.config.ts`.
 *
 * The script is intentionally a `.cjs` file so it can be invoked
 * from CI (e.g. `node scripts/verify-dist.cjs`) without going through
 * the vitest loader.
 *
 * Tests build a FAKE dist tree under `os.tmpdir()` and let the script
 * walk it. This proves the script reads plist data correctly without
 * requiring a real Electron build to pass.
 */

const SCRIPT_PATH = join(__dirname, '../scripts/verify-dist.cjs')

function fakePlist(bundleId = 'com.alejandria.app'): string {
  // Minimal .plist body that `defaults read` can parse. We only need
  // the four keys the smoke test asserts on.
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>${bundleId}</string>
  <key>CFBundleName</key>
  <string>Alejandría</string>
  <key>CFBundleExecutable</key>
  <string>alejandria</string>
  <key>CFBundleVersion</key>
  <string>0.1.0</string>
</dict>
</plist>
`
}

function runScript(distPath: string): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('node', [SCRIPT_PATH, distPath], {
    encoding: 'utf8',
  })
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

describe('verify-dist.cjs (PR-4D)', () => {
  let workDir: string

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'alejandria-verify-'))
  })

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true })
  })

  it('passes (exit 0) when dist/Alejandria.app + Info.plist are well-formed', () => {
    const appDir = join(workDir, 'Alejandria.app', 'Contents')
    mkdirSync(join(appDir, 'MacOS'), { recursive: true })
    writeFileSync(join(appDir, 'Info.plist'), fakePlist())
    writeFileSync(join(appDir, 'MacOS', 'alejandria'), '#!/bin/sh\nexit 0\n')

    const { status, stdout, stderr } = runScript(workDir)
    expect(status, `stdout: ${stdout}\nstderr: ${stderr}`).toBe(0)
    expect(stdout).toMatch(/verify-dist: pass/i)
  })

  it('fails (exit non-zero) when the .app bundle is missing', () => {
    const { status, stdout } = runScript(workDir)
    expect(status).not.toBe(0)
    expect(stdout).toMatch(/verify-dist: fail/i)
  })

  it('fails when CFBundleIdentifier is the wrong value', () => {
    const appDir = join(workDir, 'Alejandria.app', 'Contents')
    mkdirSync(join(appDir, 'MacOS'), { recursive: true })
    writeFileSync(join(appDir, 'Info.plist'), fakePlist('com.example.wrong'))
    writeFileSync(join(appDir, 'MacOS', 'alejandria'), '')

    const { status, stdout } = runScript(workDir)
    expect(status).not.toBe(0)
    expect(stdout.toLowerCase()).toMatch(/bundleidentifier/)
  })

  it('fails when the executable is missing from MacOS/', () => {
    const appDir = join(workDir, 'Alejandria.app', 'Contents')
    mkdirSync(join(appDir, 'MacOS'), { recursive: true })
    writeFileSync(join(appDir, 'Info.plist'), fakePlist())
    // MacOS/ exists but no `alejandria` binary

    const { status, stdout } = runScript(workDir)
    expect(status).not.toBe(0)
    expect(stdout.toLowerCase()).toMatch(/executable/)
  })
})
