#!/usr/bin/env node
/**
 * verify-dist.cjs — post-build smoke test for `@alejandria/mac` (PR-4D, issue #77).
 *
 * Run after `npm run make` (electron-forge) or `electron-builder --mac`
 * to confirm the production bundle is well-formed before signing /
 * notarizing / publishing.
 *
 * Usage:
 *   node scripts/verify-dist.cjs [path-to-dist-parent]
 *
 * `path-to-dist-parent` defaults to the repository's `apps/mac/dist`
 * (the output of `npm run build`). When invoked from inside the
 * `out/make/.../darwin/x64/` tree that electron-builder produces, pass
 * that directory explicitly:
 *
 *   node scripts/verify-dist.cjs ../../../../../../../
 *
 * Exit code:
 *   0   all checks passed — the artefact can be codesigned
 *   1   one or more checks failed (the message explains which)
 *
 * The script is intentionally dependency-free (only `node:fs`,
 * `node:path`, and `node:child_process`) so it can run on a clean
 * macOS runner without a fresh `npm install`.
 */

'use strict'

const { existsSync, readFileSync, statSync } = require('node:fs')
const { join, resolve } = require('node:path')

// Fixed-shape bundle identifiers we expect on the production artefact.
// Keep these in lock-step with `electron-builder.yml` (appId),
// `forge.config.ts` (appBundleId), and the user-facing product name
// declared in `package.json`.
const EXPECTED_BUNDLE_ID = 'com.alejandria.app'
const EXPECTED_BUNDLE_NAME = 'Alejandría'
const EXPECTED_BUNDLE_EXECUTABLE = 'alejandria'

const APP_BUNDLE_NAME = 'Alejandria.app'

/**
 * Parse a string value out of an Info.plist using only XML-aware
 * primitives. We intentionally AVOID `defaults read` because it
 * mangles non-ASCII characters into `\NNN` octal escapes, which would
 * block every shipped build where the bundle name contains an
 * accented character (e.g. "Alejandría").
 *
 * The plist parser accepts the two shapes Info.plist files use:
 *   - <key>X</key><string>Y</string>          ← most keys
 *   - <key>X</key><key>…<string>Y</string>…    ← nested, ignored
 *
 * We scan top-level keys only — good enough for Info.plist's flat shape.
 */
function loadPlistKey(plistPath, key) {
  const text = readFileSync(plistPath, 'utf8')

  // Drop DTDs and comments so the regex doesn't fire on `<plist>`'s
  // OWN attribute block.
  const cleaned = text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!DOCTYPE[^>]*>/g, '')

  const re = new RegExp(
    `<key>${key}</key>[\\s\\S]*?<string>([^<]*)</string>`
  )
  const match = cleaned.match(re)
  if (!match) {
    throw new Error(`key '${key}' not found in ${plistPath}`)
  }
  return match[1]
}

function fail(msg) {
  // eslint-disable-next-line no-console
  console.log(`verify-dist: FAIL — ${msg}`)
  process.exit(1)
}

function main() {
  const userPath = process.argv[2]
  const distRoot = userPath
    ? resolve(userPath)
    : resolve(__dirname, '..', 'dist')

  const appPath = join(distRoot, APP_BUNDLE_NAME)
  const infoPlistPath = join(appPath, 'Contents', 'Info.plist')

  if (!existsSync(appPath) || !statSync(appPath).isDirectory()) {
    return fail(`bundle not found at ${appPath} (run 'npm run make' first)`)
  }
  if (!existsSync(infoPlistPath)) {
    return fail(`Info.plist missing at ${infoPlistPath}`)
  }

  let bundleId
  let bundleName
  let bundleExecutable
  try {
    bundleId = loadPlistKey(infoPlistPath, 'CFBundleIdentifier')
    bundleName = loadPlistKey(infoPlistPath, 'CFBundleName')
    bundleExecutable = loadPlistKey(infoPlistPath, 'CFBundleExecutable')
  } catch (err) {
    return fail(`could not parse Info.plist: ${err.message}`)
  }

  if (bundleId !== EXPECTED_BUNDLE_ID) {
    return fail(
      `CFBundleIdentifier is '${bundleId}', expected '${EXPECTED_BUNDLE_ID}'`
    )
  }
  if (bundleName !== EXPECTED_BUNDLE_NAME) {
    return fail(
      `CFBundleName is '${bundleName}', expected '${EXPECTED_BUNDLE_NAME}'`
    )
  }
  if (bundleExecutable !== EXPECTED_BUNDLE_EXECUTABLE) {
    return fail(
      `CFBundleExecutable is '${bundleExecutable}', expected '${EXPECTED_BUNDLE_EXECUTABLE}'`
    )
  }

  const executablePath = join(
    appPath,
    'Contents',
    'MacOS',
    EXPECTED_BUNDLE_EXECUTABLE
  )
  if (!existsSync(executablePath)) {
    return fail(`executable missing at ${executablePath}`)
  }

  // eslint-disable-next-line no-console
  console.log(
    `verify-dist: pass — ${APP_BUNDLE_NAME} (${bundleId}, CFBundleVersion ${loadPlistKey(
      infoPlistPath,
      'CFBundleVersion'
    )})`
  )
  process.exit(0)
}

main()
