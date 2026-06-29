import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * TDD tests for `src/preload.ts` (PR-4C, issue #75).
 *
 * The preload script is the ONLY place inside the Electron sandbox
 * that touches `window`. It MUST use `contextBridge.exposeInMainWorld`
 * to publish a frozen, typed surface (`window.alejandria`) that the
 * Next.js renderer can call without ever touching Node primitives.
 *
 * The required surface (per issue #75):
 *   - `download(bookId)`        — IPC channel to NAS download flow
 *   - `sync(direction)`         — IPC channel to iCloud sync engine
 *   - `scan(localPath)`         — IPC channel to spawn sidecar
 *   - `version()`               — returns version metadata
 *
 * We mock `electron` so we can assert the exact channel names and
 * payload shapes the renderer will use.
 */

const exposeInMainWorld = vi.fn()
const ipcRendererInvoke = vi.fn()

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld,
  },
  ipcRenderer: {
    invoke: ipcRendererInvoke,
  },
}))

describe('preload — window.alejandria surface (PR-4C)', () => {
  beforeEach(() => {
    exposeInMainWorld.mockReset()
    ipcRendererInvoke.mockReset()
    // Re-import the module under test so each test gets a fresh
    // module-level `expose()` call.
    vi.resetModules()
  })

  it('exposes window.alejandria via contextBridge.exposeInMainWorld', async () => {
    const { expose } = await import('../src/preload')
    expose()

    expect(exposeInMainWorld).toHaveBeenCalledTimes(1)
    expect(exposeInMainWorld).toHaveBeenCalledWith(
      'alejandria',
      expect.objectContaining({
        download: expect.any(Function),
        sync: expect.any(Function),
        scan: expect.any(Function),
        version: expect.any(Function),
      }),
    )
  })

  it('download(bookId) invokes the aleja:download IPC channel with the book id', async () => {
    const { expose } = await import('../src/preload')
    expose()
    const surface = exposeInMainWorld.mock.calls[0]![1] as {
      download: (bookId: string) => Promise<unknown>
    }

    ipcRendererInvoke.mockResolvedValueOnce({ ok: true, bookId: 'b-123' })

    const result = await surface.download('b-123')

    expect(ipcRendererInvoke).toHaveBeenCalledWith('aleja:download', 'b-123')
    expect(result).toEqual({ ok: true, bookId: 'b-123' })
  })

  it('sync("pull") and sync("push") invoke the aleja:sync IPC channel', async () => {
    const { expose } = await import('../src/preload')
    expose()
    const surface = exposeInMainWorld.mock.calls[0]![1] as {
      sync: (direction: 'pull' | 'push') => Promise<unknown>
    }

    await surface.sync('pull')
    await surface.sync('push')

    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(1, 'aleja:sync', 'pull')
    expect(ipcRendererInvoke).toHaveBeenNthCalledWith(2, 'aleja:sync', 'push')
  })

  it('scan(localPath) invokes the aleja:scan IPC channel with the absolute path', async () => {
    const { expose } = await import('../src/preload')
    expose()
    const surface = exposeInMainWorld.mock.calls[0]![1] as {
      scan: (localPath: string) => Promise<unknown>
    }

    ipcRendererInvoke.mockResolvedValueOnce({ ok: true })

    await surface.scan('/Users/me/Library/calibre/rayuela.epub')

    expect(ipcRendererInvoke).toHaveBeenCalledWith(
      'aleja:scan',
      '/Users/me/Library/calibre/rayuela.epub',
    )
  })

  it('version() returns an object with the Electron + Node + Chrome versions', async () => {
    const { expose } = await import('../src/preload')
    expose()
    const surface = exposeInMainWorld.mock.calls[0]![1] as {
      version: () => Promise<unknown>
    }

    ipcRendererInvoke.mockResolvedValueOnce({
      electron: '33.0.0',
      node: '20.19.0',
      chrome: '130.0.0',
    })

    const result = await surface.version()

    expect(ipcRendererInvoke).toHaveBeenCalledWith('aleja:version')
    expect(result).toMatchObject({
      electron: expect.any(String),
      node: expect.any(String),
      chrome: expect.any(String),
    })
  })
})
