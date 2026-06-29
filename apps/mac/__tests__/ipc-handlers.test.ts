import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * TDD tests for `src/ipc-handlers.ts` (PR-4C, issue #75).
 *
 * The main process registers four `ipcMain.handle` listeners that
 * the renderer (via the preload bridge) invokes:
 *
 *   - `aleja:download`  — payload: bookId: string
 *   - `aleja:sync`      — payload: direction: 'pull' | 'push'
 *   - `aleja:scan`      — payload: localPath: string
 *   - `aleja:version`   — payload: none, returns versions
 *
 * Each handler MUST validate its payload and throw a serializable
 * Error so the renderer's `ipcRenderer.invoke` promise rejects
 * with a useful message.
 *
 * The scan handler MUST route through the injected
 * `SidecarManager` (lazy spawn, shared child) and parse the
 * sidecar's JSON envelope.
 */

const handle = vi.fn()
const removeHandler = vi.fn()

vi.mock('electron', () => ({
  ipcMain: {
    handle,
    removeHandler,
  },
  app: {
    getVersion: () => '0.1.0',
    getPath: (name: string) => `/Users/me/Library/Application Support/alejandria/${name}`,
  },
}))

interface FakeHandlerCall {
  channel: string
  fn: (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown
}

function lastHandlerFor(channel: string): FakeHandlerCall {
  const match = handle.mock.calls.find((c) => c[0] === channel)
  if (!match) throw new Error(`no handler registered for ${channel}`)
  return { channel: match[0] as string, fn: match[1] as FakeHandlerCall['fn'] }
}

describe('ipc-handlers (PR-4C)', () => {
  beforeEach(() => {
    handle.mockReset()
    removeHandler.mockReset()
    vi.resetModules()
  })

  it('registers exactly the four channels required by issue #75', async () => {
    const { registerIpcHandlers } = await import('../src/ipc-handlers')
    const sidecar = { getProcess: vi.fn() }
    const downloader = { download: vi.fn() }
    const syncer = { sync: vi.fn() }

    registerIpcHandlers({ sidecar, downloader, syncer } as never)

    const channels = handle.mock.calls.map((c) => c[0]).sort()
    expect(channels).toEqual(['aleja:download', 'aleja:scan', 'aleja:sync', 'aleja:version'])
  })

  it('aleja:download handler passes the bookId to the injected downloader', async () => {
    const { registerIpcHandlers } = await import('../src/ipc-handlers')
    const downloader = { download: vi.fn().mockResolvedValue({ ok: true, bookId: 'b-9' }) }
    const sidecar = { getProcess: vi.fn() }
    const syncer = { sync: vi.fn() }

    registerIpcHandlers({ sidecar, downloader, syncer } as never)
    const { fn } = lastHandlerFor('aleja:download')

    const result = await fn({}, 'b-9')

    expect(downloader.download).toHaveBeenCalledWith('b-9')
    expect(result).toEqual({ ok: true, bookId: 'b-9' })
  })

  it('aleja:download handler rejects when bookId is missing or not a string', async () => {
    const { registerIpcHandlers } = await import('../src/ipc-handlers')
    const sidecar = { getProcess: vi.fn() }
    const downloader = { download: vi.fn() }
    const syncer = { sync: vi.fn() }

    registerIpcHandlers({ sidecar, downloader, syncer } as never)
    const { fn } = lastHandlerFor('aleja:download')

    await expect(fn({}, undefined)).rejects.toThrow(/bookId/)
    await expect(fn({}, 42)).rejects.toThrow(/bookId/)
    await expect(fn({}, '')).rejects.toThrow(/bookId/)
    expect(downloader.download).not.toHaveBeenCalled()
  })

  it('aleja:sync handler rejects when direction is not "pull" or "push"', async () => {
    const { registerIpcHandlers } = await import('../src/ipc-handlers')
    const sidecar = { getProcess: vi.fn() }
    const downloader = { download: vi.fn() }
    const syncer = { sync: vi.fn().mockResolvedValue({ ok: true }) }

    registerIpcHandlers({ sidecar, downloader, syncer } as never)
    const { fn } = lastHandlerFor('aleja:sync')

    await expect(fn({}, 'sideways')).rejects.toThrow(/direction/)
    await expect(fn({}, undefined)).rejects.toThrow(/direction/)
    expect(syncer.sync).not.toHaveBeenCalled()
  })

  it('aleja:sync handler forwards "pull" and "push" to the injected syncer', async () => {
    const { registerIpcHandlers } = await import('../src/ipc-handlers')
    const sidecar = { getProcess: vi.fn() }
    const downloader = { download: vi.fn() }
    const syncer = { sync: vi.fn().mockResolvedValue({ ok: true }) }

    registerIpcHandlers({ sidecar, downloader, syncer } as never)
    const { fn } = lastHandlerFor('aleja:sync')

    await fn({}, 'pull')
    await fn({}, 'push')

    expect(syncer.sync).toHaveBeenNthCalledWith(1, 'pull')
    expect(syncer.sync).toHaveBeenNthCalledWith(2, 'push')
  })

  it('aleja:scan handler rejects when localPath is missing or not a string', async () => {
    const { registerIpcHandlers } = await import('../src/ipc-handlers')
    const sidecar = { getProcess: vi.fn() }
    const downloader = { download: vi.fn() }
    const syncer = { sync: vi.fn() }

    registerIpcHandlers({ sidecar, downloader, syncer } as never)
    const { fn } = lastHandlerFor('aleja:scan')

    await expect(fn({}, undefined)).rejects.toThrow(/localPath/)
    await expect(fn({}, 42)).rejects.toThrow(/localPath/)
    await expect(fn({}, '')).rejects.toThrow(/localPath/)
  })

  it('aleja:version handler returns electron, node and chrome version objects', async () => {
    const { registerIpcHandlers } = await import('../src/ipc-handlers')
    const sidecar = { getProcess: vi.fn() }
    const downloader = { download: vi.fn() }
    const syncer = { sync: vi.fn() }

    registerIpcHandlers({ sidecar, downloader, syncer } as never)
    const { fn } = lastHandlerFor('aleja:version')

    const result = (await fn({})) as Record<string, string>

    expect(result).toMatchObject({
      electron: expect.any(String),
      node: expect.any(String),
      chrome: expect.any(String),
      app: expect.any(String),
    })
  })
})
