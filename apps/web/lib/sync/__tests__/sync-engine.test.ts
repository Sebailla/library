/**
 * TDD tests for `lib/sync/sync-engine.ts` (PR-4B, #73).
 *
 * The engine wires the writer, watcher, and conflict
 * resolver into one façade that the app code consumes.
 *
 * The three behaviours that matter for v1:
 *
 *   1. **pull-on-startup** — at construction, the engine
 *      reads every existing file under the iCloud root and
 *      exposes them via `listAll()`. New files added after
 *      construction are emitted as `change` events from the
 *      watcher; the engine converts those into `onChange`
 *      listener notifications and into in-memory index
 *      updates.
 *
 *   2. **push-on-write** — calling `push(note)` writes a
 *      `SyncFile` to disk via the writer, then updates
 *      the in-memory index. (The watcher also fires `add`
 *      because we just created a file; we swallow that
 *      re-emission to avoid double-counting.)
 *
 *   3. **merge-on-conflict** — when an external write
 *      arrives (chokidar `add` or `change` for a file that
 *      is already in the index), the engine runs the
 *      injected `resolveConflict` function and re-emits the
 *      merged value as a `change` event for app listeners.
 *
 * We exercise the engine against an in-memory `SyncFs`
 * and a synchronous fake `Watcher` (built inline) so this
 * test file exercises no chokidar / no real iCloud Drive.
 *
 * One additional invariant: the engine never throws on a
 * malformed file. The `decode` step is allowed to return
 * `null` and the engine must skip that entry without
 * crashing.
 */

import { describe, expect, it, vi } from 'vitest'

import {
  createSyncEngine,
  type CreateSyncEngineArgs,
  type ManualWatcher,
} from '../sync-engine'
import { resolveSyncConflict } from '../conflict-resolver'
import type { SyncFile, SyncFs, Note, WatcherEvent } from '../types'

/**
 * Helper type for tests that always deal with `Note`
 * payloads. The public `SyncFile.payload` is a union
 * because the engine stores four activity kinds; tests
 * narrow it to `Note` so they can read `.text`.
 */
type NoteSyncFile = SyncFile & { payload: Note }

class InMemoryFs implements SyncFs {
  files = new Map<string, string>()

  /**
   * Returns the immediate children of `dir`. Real
   * `fs.readdir` does NOT recurse — it only returns
   * direct entries. The engine's pull walks the tree
   * itself.
   *
   * We pre-normalize separators so macOS-built paths
   * compare equal to Windows-built ones during tests.
   */
  async readdir(dir: string): Promise<string[]> {
    const normDir = dir.replace(/\\/g, '/').replace(/\/$/, '')
    const out = new Set<string>()
    for (const p of this.files.keys()) {
      const normP = p.replace(/\\/g, '/')
      const prefix = `${normDir}/`
      if (!normP.startsWith(prefix)) continue
      const rest = normP.slice(prefix.length)
      const child = rest.split('/')[0]
      if (child) out.add(`${normDir}/${child}`)
    }
    return [...out]
  }
  async readFile(path: string): Promise<string> {
    const v = this.files.get(path)
    if (v === undefined) throw new Error(`ENOENT: ${path}`)
    return v
  }
  async writeFile(path: string, contents: string): Promise<void> {
    this.files.set(path, contents)
  }
  async unlink(path: string): Promise<void> {
    this.files.delete(path)
  }
  async mkdir(): Promise<void> {
    /* noop */
  }
  async stat(path: string): Promise<{ mtimeMs: number }> {
    if (!this.files.has(path)) throw new Error(`ENOENT: ${path}`)
    return { mtimeMs: 1 }
  }
}

function manualWatcher(): ManualWatcher {
  const handlers: Array<(e: WatcherEvent) => void> = []
  return {
    start() {
      /* noop */
    },
    async close() {
      /* noop */
    },
    onEvent(h) {
      handlers.push(h)
    },
    emit(e: WatcherEvent) {
      for (const h of handlers) h(e)
    },
  }
}

const note = (id: string, text: string): NoteSyncFile => ({
  version: 1,
  bookId: 'b1',
  category: 'notes',
  updatedAt: '2026-06-01T10:00:00.000Z',
  payload: {
    id,
    bookId: 'b1',
    locator: 'cfi=10',
    text,
    createdAt: '2026-06-01T10:00:00.000Z',
    updatedAt: '2026-06-01T10:00:00.000Z',
  },
})

function makeEngine(args: {
  fs: InMemoryFs
  watcher: ManualWatcher
  decode?(raw: unknown): SyncFile | null
}) {
  const opts: CreateSyncEngineArgs = {
    icloudDir: '/tmp/alejandria',
    fs: args.fs,
    watcher: args.watcher,
    decode: args.decode ?? ((raw) => raw as SyncFile),
    resolveConflict: resolveSyncConflict,
  }
  return createSyncEngine(opts)
}

describe('sync/sync-engine (PR-4B, #73)', () => {
  it('pull-on-startup: reads every existing file and indexes it', async () => {
    const fs = new InMemoryFs()
    fs.files.set(
      '/tmp/alejandria/notes/b1.json',
      JSON.stringify(note('n-1', 'a')),
    )
    fs.files.set(
      '/tmp/alejandria/progress/b1.json',
      JSON.stringify({
        version: 1,
        bookId: 'b1',
        category: 'progress',
        updatedAt: '2026-06-01T10:00:00.000Z',
        payload: { bookId: 'b1', currentLocator: 'cfi=10', percent: 0.5, updatedAt: '2026-06-01T10:00:00.000Z' },
      }),
    )

    const engine = makeEngine({ fs, watcher: manualWatcher() })
    await engine.start()

    const all = await engine.listAll()
    expect(all.sort()).toEqual([
      '/tmp/alejandria/notes/b1.json',
      '/tmp/alejandria/progress/b1.json',
    ])

    const byPath = (await engine.get('/tmp/alejandria/notes/b1.json')) as NoteSyncFile | null
    expect(byPath?.payload.text).toBe('a')

    await engine.close()
  })

  it('push: writes a file and updates the in-memory index', async () => {
    const fs = new InMemoryFs()
    const engine = makeEngine({ fs, watcher: manualWatcher() })
    await engine.start()

    await engine.push({
      category: 'notes',
      bookId: 'b1',
      data: {
        id: 'n-1',
        bookId: 'b1',
        locator: 'cfi=10',
        text: 'first',
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      },
    })

    expect(fs.files.has('/tmp/alejandria/notes/b1.json')).toBe(true)
    const got = (await engine.get('/tmp/alejandria/notes/b1.json')) as NoteSyncFile | null
    expect(got?.payload.text).toBe('first')

    await engine.close()
  })

  it('merge: prefers the newer file when chokidar reports a remote write', async () => {
    const fs = new InMemoryFs()
    // Pre-populate with the older version.
    fs.files.set(
      '/tmp/alejandria/notes/b1.json',
      JSON.stringify(note('n-1', 'old-text')),
    )

    const watcher = manualWatcher()
    const events: NoteSyncFile[] = []
    const engine = makeEngine({ fs, watcher })
    await engine.start()
    engine.onChange((sf) => {
      events.push(sf as NoteSyncFile)
    })

    // Remote writes a newer version directly into the file.
    fs.files.set(
      '/tmp/alejandria/notes/b1.json',
      JSON.stringify({ ...note('n-1', 'new-text'), updatedAt: '2026-06-02T10:00:00.000Z' }),
    )
    watcher.emit({
      filePath: '/tmp/alejandria/notes/b1.json',
      kind: 'change',
      mtimeMs: 2,
    })

    // Allow microtasks to flush.
    await new Promise((r) => setImmediate(r))

    const merged = (await engine.get('/tmp/alejandria/notes/b1.json')) as NoteSyncFile | null
    expect(merged?.payload.text).toBe('new-text')
    expect(events).toHaveLength(1)
    expect(events[0]?.payload.text).toBe('new-text')

    await engine.close()
  })

  it('merge: when local is newer, the local version is kept', async () => {
    const fs = new InMemoryFs()
    fs.files.set(
      '/tmp/alejandria/notes/b1.json',
      JSON.stringify({
        ...note('n-1', 'local-newer'),
        updatedAt: '2026-06-02T10:00:00.000Z',
      }),
    )

    const watcher = manualWatcher()
    const engine = makeEngine({ fs, watcher })
    await engine.start()

    // Remote write of an OLDER version (e.g. slow device).
    fs.files.set(
      '/tmp/alejandria/notes/b1.json',
      JSON.stringify(note('n-1', 'remote-older')),
    )
    watcher.emit({
      filePath: '/tmp/alejandria/notes/b1.json',
      kind: 'change',
      mtimeMs: 1,
    })
    await new Promise((r) => setImmediate(r))

    const merged = (await engine.get('/tmp/alejandria/notes/b1.json')) as NoteSyncFile | null
    expect(merged?.payload.text).toBe('local-newer')

    await engine.close()
  })

  it('decode returning null does not crash the engine', async () => {
    const fs = new InMemoryFs()
    fs.files.set('/tmp/alejandria/notes/b1.json', 'this is not json {{{}')

    const watcher = manualWatcher()
    const decode = vi.fn().mockReturnValue(null)
    const engine = makeEngine({ fs, watcher, decode })
    await engine.start()

    expect(decode).toHaveBeenCalled()
    // No entries in the index.
    const all = await engine.listAll()
    expect(all).toEqual([])

    await engine.close()
  })

  it('onChange on push carries our own write through to subscribers', async () => {
    const fs = new InMemoryFs()
    const watcher = manualWatcher()
    const events: NoteSyncFile[] = []
    const engine = makeEngine({ fs, watcher })
    await engine.start()
    engine.onChange((sf) => events.push(sf as NoteSyncFile))

    await engine.push({
      category: 'notes',
      bookId: 'b1',
      data: {
        id: 'n-1',
        bookId: 'b1',
        locator: 'cfi=10',
        text: 'first',
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      },
    })
    expect(events).toHaveLength(1)
    expect(events[0]?.payload.text).toBe('first')

    await engine.close()
  })

  it('unlink: removes the entry from the in-memory index', async () => {
    const fs = new InMemoryFs()
    fs.files.set(
      '/tmp/alejandria/notes/b1.json',
      JSON.stringify(note('n-1', 'a')),
    )

    const watcher = manualWatcher()
    const engine = makeEngine({ fs, watcher })
    await engine.start()
    expect((await engine.listAll()).length).toBe(1)

    fs.files.delete('/tmp/alejandria/notes/b1.json')
    watcher.emit({
      filePath: '/tmp/alejandria/notes/b1.json',
      kind: 'unlink',
      mtimeMs: null,
    })
    await new Promise((r) => setImmediate(r))

    expect(await engine.listAll()).toEqual([])

    await engine.close()
  })
})
