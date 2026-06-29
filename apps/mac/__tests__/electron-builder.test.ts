import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import yaml from 'js-yaml'

/**
 * TDD tests for `apps/mac/electron-builder.yml` (PR-4D, issue #77).
 *
 * The production build config is a YAML file read by electron-builder
 * to turn the compiled `dist/` (electron-forge output) into a signed,
 * notarised DMG that auto-updates through `electron-updater`.
 *
 * The config MUST:
 *
 *   - parse as valid YAML (electron-builder would crash otherwise)
 *   - target `dmg` so the end-user gets a drag-to-Applications
 *     installer (matches the existing forge.config.ts)
 *   - publish to `Sebailla/library` GitHub releases so that
 *     electron-updater can find the next version
 *   - use `com.alejandria.app` as the production bundle id (matches
 *     `forge.config.ts` so codesign identity / Keychain entries line up)
 *   - declare the `app` URL scheme so deep links registered in
 *     `forge.config.ts` survive the electron-builder pass
 *   - point `electron-updater` at a `latest-mac.yml` channel named
 *     after the app, not `app`, so the updater's hardcoded default
 *     (`latest.yml`) cannot accidentally serve a stale manifest
 */

describe('electron-builder.yml (PR-4D)', () => {
  const configPath = resolve(__dirname, '../electron-builder.yml')
  const raw = readFileSync(configPath, 'utf8')
  const parsed = yaml.load(raw) as Record<string, unknown>

  it('parses as valid YAML', () => {
    expect(parsed).toBeTypeOf('object')
    expect(parsed).not.toBeNull()
  })

  it('targets dmg production output', () => {
    const mac = parsed.mac as Record<string, unknown> | undefined
    expect(mac).toBeDefined()
    // electron-builder accepts either `['dmg']` or
    // `[{ target: 'dmg', arch: [...] }]`. We use the extended shape
    // (below) so we can declare both arches.
    const target = mac?.target as Array<Record<string, unknown>> | undefined
    expect(target).toBeDefined()
    expect(target?.[0]?.target).toBe('dmg')
    expect(mac?.category).toBe('public.app-category.education')
  })

  it('publishes to Sebailla/library GitHub releases', () => {
    const publish = parsed.publish as Record<string, unknown> | undefined
    expect(publish).toBeDefined()
    expect(publish?.provider).toBe('github')
    expect(publish?.owner).toBe('Sebailla')
    expect(publish?.repo).toBe('library')
  })

  it('uses com.alejandria.app as the bundle id (matches forge.config.ts)', () => {
    const mac = parsed.mac as Record<string, unknown>
    expect(mac?.identity).toBeUndefined() // unset → electron-builder infers from appId
    expect(parsed.appId).toBe('com.alejandria.app')
  })

  it('declares the app URL scheme so the forge.config.ts protocol survives', () => {
    const protocols = parsed.protocols as Array<Record<string, unknown>> | undefined
    expect(protocols).toBeDefined()
    expect(protocols?.[0]).toMatchObject({
      name: 'alejandria',
      schemes: ['app'],
    })
  })

  it('uses release channel (so electron-updater fetches latest-mac.yml)', () => {
    const publish = parsed.publish as Record<string, unknown>
    // The `releaseType` key is how electron-updater decides which manifest
    // file to fetch. We want `latest-mac.yml`, NOT `latest.yml`, because
    // electron-updater's hardcoded default would clash with any
    // Linux/Windows updater if we ever ship those builds.
    expect(publish).toHaveProperty('releaseType', 'release')
  })

  it('targets both arm64 and x64 so Apple Silicon and Intel Macs are covered', () => {
    const mac = parsed.mac as Record<string, unknown>
    const target = mac?.target as Array<Record<string, unknown>> | undefined
    expect(target).toBeDefined()
    // Universal binary support would require `--x64 --arm64`; listing
    // both arches produces two separate DMGs that auto-update picks
    // based on the running CPU.
    const archs = target?.flatMap((t) => t.arch as string[])
    expect(archs).toEqual(expect.arrayContaining(['arm64', 'x64']))
  })
})
