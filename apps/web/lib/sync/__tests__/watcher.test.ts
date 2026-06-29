/**
 * TDD tests for `lib/sync/watcher.ts` (PR-4B, #73).
 *
 * The watcher is a thin wrapper around `chokidar`. It
 * exists so the engine can depend on a small, typed
 * `Watcher` interface rather than a third-party package
 * directly — and so we can mock chokidar in tests with
 * zero filesystem I/O.
 *
 * These tests do NOT exercise chokidar itself. Instead
 * they verify that the wrapper:
 *
 *  - opens the supplied directory (not a wildcard, not
 *    a parent directory) with `ignoreInitial: false` so
 *    pull-on-startup sees existing files;
 *  - re-emits chokidar's `add` / `change` / `unlink`
 *    events as `WatcherEvent`s with `kind` set;
 *  - sets `mtimeMs` from `fs.stat` on add / change and
 *    `null` on unlink;
 *  - ignores other chokidar events (`ready`, `error`,
 *    `addDir`, etc.);
 *  - closes cleanly and stops emitting afterwards.
 *
 * Chokidar is stubbed out by passing a fake `ChokidarFn`
 * that records construction args and returns a stub
 * `FSWatcher`. This is the same pattern used by every
 * mature chokidar consumer (Babel, Vite, etc.).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'

import { createWatcher, type ChokidarFn } from '../watcher'
import type { FSWatcher } from 'chokidar'

class FakeFsWatcher extends EventEmitter {
  // Cast at the boundary so we don't have to keep up with
  // chokidar's private `FSWatcher` overload set.
  add(_paths: string[]): this { return this }
  addCwd(_path: string): this { return this }
  addRaw(): this { return this }
  async close(): Promise<void> {
    this.closed = true
    return Promise.resolve()
  }
  closed = false
  getWatched(): Record<string, string[]> { return {} }
  // Suppress noImplicitOverride so tests can pre-build the
  // exact ergonomic surface they need. EventEmitter's `on`
  // is sufficiently broad for the wrapper tests.
}

interface ChokidarCall {
  path: string
  options: Record<string, unknown> | undefined
  watcher: FakeFsWatcher
}

function makeChokidar(): { fn: ChokidarFn; calls: ChokidarCall[] } {
  const calls: ChokidarCall[] = []
  const fn: ChokidarFn = (path, options) => {
    const watcher = new FakeFsWatcher()
    calls.push({ path, options, watcher })
    return watcher as unknown as FSWatcher
  }
  return { fn, calls }
}

describe('sync/watcher (PR-4B, #73)', () => {
  let chokidar: ReturnType<typeof makeChokidar>

  beforeEach(() => {
    chokidar = makeChokidar()
  })

  it('opens the supplied directory with ignoreInitial:false', () => {
    createWatcher({ icloudDir: '/tmp/alejandria', stat: vi.fn(), chokidar: chokidar.fn })
    expect(chokidar.calls).toHaveLength(1)
    expect(chokidar.calls[0]?.path).toBe('/tmp/alejandria')
    expect(chokidar.calls[0]?.options).toMatchObject({ ignoreInitial: false })
  })

  it('emits add events with the file path and a stat-derived mtimeMs', async () => {
    const stat = vi.fn().mockResolvedValue({ mtimeMs: 1700000000000 })
    const watcher = createWatcher({
      icloudDir: '/tmp/alejandria',
      stat,
      chokidar: chokidar.fn,
    })
    const events: unknown[] = []
    watcher.onEvent((e) => events.push(e))

    const fakeWatcher = chokidar.calls[0]?.watcher
    fakeWatcher?.emit('add', '/tmp/alejandria/notes/a.json')
    // Allow async stat to resolve.
    await new Promise((r) => setImmediate(r))

    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({
      filePath: '/tmp/alejandria/notes/a.json',
      kind: 'add',
      mtimeMs: 1700000000000,
    })
    expect(stat).toHaveBeenCalledWith('/tmp/alejandria/notes/a.json')
  })

  it('emits change events with kind=change', async () => {
    const stat = vi.fn().mockResolvedValue({ mtimeMs: 42 })
    const watcher = createWatcher({
      icloudDir: '/tmp/alejandria',
      stat,
      chokidar: chokidar.fn,
    })
    const events: unknown[] = []
    watcher.onEvent((e) => events.push(e))

    chokidar.calls[0]?.watcher.emit('change', '/tmp/alejandria/notes/a.json')
    await new Promise((r) => setImmediate(r))

    expect(events[0]).toMatchObject({ kind: 'change', mtimeMs: 42 })
  })

  it('emits unlink events with mtimeMs=null without calling stat', async () => {
    const stat = vi.fn()
    const watcher = createWatcher({
      icloudDir: '/tmp/alejandria',
      stat,
      chokidar: chokidar.fn,
    })
    const events: unknown[] = []
    watcher.onEvent((e) => events.push(e))

    chokidar.calls[0]?.watcher.emit('unlink', '/tmp/alejandria/notes/a.json')
    await new Promise((r) => setImmediate(r))

    expect(events[0]).toEqual({
      filePath: '/tmp/alejandria/notes/a.json',
      kind: 'unlink',
      mtimeMs: null,
    })
    expect(stat).not.toHaveBeenCalled()
  })

  it('ignores unrelated chokidar events (addDir, ready, error)', async () => {
    const stat = vi.fn()
    const watcher = createWatcher({
      icloudDir: '/tmp/alejandria',
      stat,
      chokidar: chokidar.fn,
    })
    const events: unknown[] = []
    watcher.onEvent((e) => events.push(e))

    const fw = chokidar.calls[0]?.watcher
    fw?.emit('addDir', '/tmp/alejandria/notes')
    fw?.emit('ready')
    fw?.emit('error', new Error('boom'))
    await new Promise((r) => setImmediate(r))

    expect(events).toHaveLength(0)
    expect(stat).not.toHaveBeenCalled()
  })

  it('close() stops emitting events', async () => {
    const stat = vi.fn().mockResolvedValue({ mtimeMs: 1 })
    const watcher = createWatcher({
      icloudDir: '/tmp/alejandria',
      stat,
      chokidar: chokidar.fn,
    })
    const events: unknown[] = []
    watcher.onEvent((e) => events.push(e))

    const fw = chokidar.calls[0]?.watcher
    await watcher.close()
    fw?.emit('add', '/tmp/alejandria/notes/a.json')
    await new Promise((r) => setImmediate(r))

    expect(events).toHaveLength(0)
    expect(fw?.closed).toBe(true)
  })
})
