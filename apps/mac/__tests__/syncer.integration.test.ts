import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as wait } from 'node:timers/promises'

/**
 * TDD integration tests for `src/syncer.ts` (PR-N8, issue #94).
 *
 * Scope: the syncer is the iCloud Drive bridge. Two phases:
 *
 *   - pull-on-startup: scan the iCloud root, report every file that
 *     exists at the moment the watcher starts. Backed by chokidar's
 *     `ignoreInitial: false` so existing rows are part of the startup
 *     payload, NOT a watch event.
 *
 *   - push-on-write: when the user modifies a file in the iCloud
 *     root, the syncer emits a `change` event so the mac app can
 *     mirror it to the local library cache. We verify this by
 *     wiring up a single-shot listener and writing a file inside
 *     the watched directory.
 *
 * The syncer MUST:
 *
 *   1. Run `pull()` exactly once on startup when constructed.
 *   2. Emit a `change` event per file added/changed inside the dir.
 *   3. Expose `close()` that stops the underlying chokidar handle.
 *   4. Tolerate an empty directory on startup (no rows).
 */

describe('syncer (PR-N8, iCloud sync engine)', () => {
  let workDir: string
  let cloudDir: string

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'alejandria-mac-syncer-'))
    cloudDir = join(workDir, 'icloud')
    mkdirSync(cloudDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true })
  })

  it('pull() returns every file already in the iCloud directory on startup', async () => {
    writeFileSync(join(cloudDir, 'a.json'), '{"id":1}')
    writeFileSync(join(cloudDir, 'b.json'), '{"id":2}')
    mkdirSync(join(cloudDir, 'sub'), { recursive: true })
    writeFileSync(join(cloudDir, 'sub', 'c.json'), '{"id":3}')

    const { createIcloudSyncer } = await import('../src/syncer')
    const syncer = createIcloudSyncer({ cloudDir })
    const initial = await syncer.pull()

    expect(initial.direction).toBe('pull')
    expect(initial.transport).toBe('icloud')
    // The syncer returns absolute paths so the renderer does not
    // have to resolve them against the AppBundle. We assert on the
    // basenames so the test stays robust across platforms.
    const basenames = initial.files.map((f) => f.split('/').pop() ?? '').sort()
    expect(basenames).toEqual(expect.arrayContaining(['a.json', 'b.json', 'c.json']))
    await syncer.close()
  })

  it('push() emits a change event for every file written into the iCloud root', async () => {
    const { createIcloudSyncerReady } = await import('../src/syncer')
    // Use the `Ready` factory so the watcher is fully wired
    // (chokidar has emitted its `ready` event) BEFORE the test
    // writes a file — without this, the write can race the
    // listener registration on slow runners.
    const syncer = await createIcloudSyncerReady({ cloudDir, awaitWriteFinishMs: 25 })
    // drain the startup pull
    await syncer.pull()

    const seen: string[] = []
    syncer.on('change', (file: string) => seen.push(file))

    writeFileSync(join(cloudDir, 'fresh.json'), '{"id":4}')
    // Poll for up to 2 s because chokidar's awaitWriteFinish
    // depends on platform-specific debouncing; the event is
    // eventually emitted, we just don't know exactly when.
    const deadline = Date.now() + 2_000
    while (Date.now() < deadline && !seen.some((f) => f.endsWith('fresh.json'))) {
      await wait(50)
    }

    expect(seen.some((f) => f.endsWith('fresh.json'))).toBe(true)
    await syncer.close()
  })

  it('close() stops the watcher so writes are no longer observed', async () => {
    const { createIcloudSyncer } = await import('../src/syncer')
    const syncer = createIcloudSyncer({ cloudDir })
    await syncer.pull()
    const seen: string[] = []
    syncer.on('change', (file: string) => seen.push(file))

    await syncer.close()

    writeFileSync(join(cloudDir, 'late.json'), '{"id":5}')
    await wait(150)

    expect(seen).toHaveLength(0)
  })

  it('pull() on an empty iCloud directory returns an empty file list', async () => {
    const { createIcloudSyncer } = await import('../src/syncer')
    const syncer = createIcloudSyncer({ cloudDir })
    const initial = await syncer.pull()
    expect(initial.files).toEqual([])
    await syncer.close()
  })

  it('the syncer module re-exports the Syncer factory for the IPC layer', async () => {
    const mod = (await import('../src/syncer')) as Record<string, unknown>
    expect(typeof mod['createIcloudSyncer']).toBe('function')
    // IcloudSyncer MUST be the runtime class because the IPC
    // handler's `syncer.sync(dir)` needs to call a method on it.
    expect(typeof mod['IcloudSyncer']).toBe('function')
    // `createIcloudSyncerFromFs` is the test seam — exposed as a
    // named export so future tests can opt out of the chokidar
    // handle without monkey-patching the module.
    expect(typeof mod['createIcloudSyncerFromFs']).toBe('function')
  })

  it('listdir() on cloud root after a write reflects the new file (filesystem truth)', async () => {
    // Sanity guard — does not exercise the syncer directly but
    // confirms the integration setup itself is sound (catches FS
    // permission surprises early).
    writeFileSync(join(cloudDir, 'exists.json'), '{}')
    const files = readdirSync(cloudDir)
    expect(files).toContain('exists.json')
  })
})
