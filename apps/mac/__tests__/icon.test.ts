import { describe, expect, it } from 'vitest'
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import yaml from 'js-yaml'

/**
 * TDD tests for the custom app icon (issue #112).
 *
 * Before this change the Mac app shipped with Electron's default
 * diamond logo. The icon is now a stylised open book on warm
 * parchment (academic library aesthetic), generated from
 * `apps/mac/scripts/generate-icon.py` and consumed by both
 * `forge.config.ts` (electron-forge) and `electron-builder.yml`
 * (electron-builder) so `npm run package` and
 * `npm run dist:mac:unsigned` both produce a .app/.dmg with the
 * custom icon visible in Finder/Dock/Launchpad.
 *
 * Tests cover:
 *   - the master PNG exists at the right size
 *   - the .iconset contains the 10 required Apple sizes
 *   - the .icns file is valid (iconutil accepts it on macOS)
 *   - forge.config.ts references the .icns in packagerConfig.icon
 *   - electron-builder.yml references the .icns in mac.icon
 *
 * The iconutil round-trip is platform-gated: it is skipped on
 * Linux CI runners so the test stays cross-platform. macOS
 * developers (and the macOS CI runner) get the strict validation.
 */

const APP_ROOT = resolve(__dirname, '..')
const BUILD_RESOURCES = resolve(APP_ROOT, 'build-resources')
const MASTER_PNG = resolve(BUILD_RESOURCES, 'icon.png')
const ICONSET_DIR = resolve(BUILD_RESOURCES, 'icon.iconset')
const ICNS_FILE = resolve(BUILD_RESOURCES, 'icon.icns')

// Apple’s standard .iconset: 10 PNGs covering 16, 32, 64, 128, 256,
// 512, and 1024 at @1x and @2x. These exact filenames are what
// `iconutil -c icns` expects.
const EXPECTED_ICONSET_FILES = [
  'icon_16x16.png',
  'icon_16x16@2x.png',
  'icon_32x32.png',
  'icon_32x32@2x.png',
  'icon_128x128.png',
  'icon_128x128@2x.png',
  'icon_256x256.png',
  'icon_256x256@2x.png',
  'icon_512x512.png',
  'icon_512x512@2x.png',
]

describe('custom app icon (issue #112)', () => {
  describe('build-resources/', () => {
    it('has the master icon.png (1024x1024)', () => {
      expect(existsSync(MASTER_PNG)).toBe(true)
      // Verify it's a real PNG with the right dimensions by reading the
      // raw bytes. A PNG header starts with the 8-byte signature
      // \x89PNG\r\n\x1a\n followed by an IHDR chunk whose width and
      // height live at bytes 16-23 (big-endian uint32).
      const buf = readFileSync(MASTER_PNG)
      // eslint-disable-next-line @typescript-eslint/no-magic-numbers
      const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      expect(buf.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true)
      const width = buf.readUInt32BE(16)
      const height = buf.readUInt32BE(20)
      expect(width).toBe(1024)
      expect(height).toBe(1024)
    })

    it('has an icon.iconset/ with all 10 expected Apple sizes', () => {
      expect(existsSync(ICONSET_DIR)).toBe(true)
      for (const name of EXPECTED_ICONSET_FILES) {
        const p = resolve(ICONSET_DIR, name)
        expect(existsSync(p), `missing ${name} in iconset`).toBe(true)
      }
    })

    it('iconset PNG sizes match their filenames', () => {
      // Map filename → expected pixel size (Apple’s @1x/@2x convention).
      const expectedSizes: Record<string, number> = {
        'icon_16x16.png': 16,
        'icon_16x16@2x.png': 32,
        'icon_32x32.png': 32,
        'icon_32x32@2x.png': 64,
        'icon_128x128.png': 128,
        'icon_128x128@2x.png': 256,
        'icon_256x256.png': 256,
        'icon_256x256@2x.png': 512,
        'icon_512x512.png': 512,
        'icon_512x512@2x.png': 1024,
      }
      for (const [name, expected] of Object.entries(expectedSizes)) {
        const buf = readFileSync(resolve(ICONSET_DIR, name))
        const width = buf.readUInt32BE(16)
        const height = buf.readUInt32BE(20)
        expect({ width, height }, `${name} size`).toEqual({ width: expected, height: expected })
      }
    })

    it('has a valid icon.icns (iconutil round-trip on macOS)', () => {
      // Skip on non-macOS: iconutil is a macOS-only binary and the
      // Linux CI runner cannot run it. We still assert the file
      // exists + has the magic bytes so the build never silently
      // loses the .icns.
      const ICNS_MAGIC = Buffer.from('icns', 'ascii')
      const buf = readFileSync(ICNS_FILE)
      expect(existsSync(ICNS_FILE)).toBe(true)
      expect(buf.subarray(0, 4).equals(ICNS_MAGIC)).toBe(true)

      if (process.platform !== 'darwin') {
        // eslint-disable-next-line no-console
        console.warn('iconutil round-trip skipped (not macOS)')
        return
      }

      // Strict validation: extract the iconset back out and confirm
      // it round-trips. If the .icns is corrupt, iconutil exits non-zero.
      // `iconutil -c iconset -o <out> <icns>` converts an .icns back to
      // an .iconset directory; that's the inverse of the build step in
      // `scripts/generate-icon.py`.
      const out = resolve(APP_ROOT, '.cache', 'icon-roundtrip.iconset')
      execSync(`iconutil -c iconset -o "${out}" "${ICNS_FILE}"`, { stdio: 'pipe' })
      expect(existsSync(out)).toBe(true)
      for (const name of EXPECTED_ICONSET_FILES) {
        expect(existsSync(resolve(out, name)), `round-trip missing ${name}`).toBe(true)
      }
    })

    it('ships the regeneration script at scripts/generate-icon.py', () => {
      const scriptPath = resolve(APP_ROOT, 'scripts', 'generate-icon.py')
      expect(existsSync(scriptPath)).toBe(true)
      // Sanity check: the script must mention iconutil so a future
      // maintainer knows the .icns is built by an external tool, not
      // by Pillow alone.
      const src = readFileSync(scriptPath, 'utf8')
      expect(src).toMatch(/iconutil/)
    })
  })

  describe('forge.config.ts (electron-forge packager)', () => {
    const raw = readFileSync(resolve(APP_ROOT, 'forge.config.ts'), 'utf8')

    it('references the .icns in packagerConfig.icon', () => {
      // The icon path is what both electron-forge and electron-builder
      // expect. Keep them identical so a designer can swap icon.png
      // once and rebuild both targets.
      expect(raw).toMatch(/icon:\s*['"]build-resources\/icon\.icns['"]/)
    })
  })

  describe('electron-builder.yml', () => {
    const raw = readFileSync(resolve(APP_ROOT, 'electron-builder.yml'), 'utf8')
    const parsed = yaml.load(raw) as Record<string, unknown>

    it('references the .icns in the mac block', () => {
      const mac = parsed.mac as Record<string, unknown> | undefined
      expect(mac?.icon).toBe('build-resources/icon.icns')
    })
  })
})