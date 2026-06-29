import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * TDD tests for `app/_actions/nas-actions.ts` (PR-3C).
 *
 * The Server Actions exposed to RSC pages live in `app/_actions/`
 * and are thin wrappers around the library code in `lib/`. The
 * contract under test:
 *
 *  - `pairDevice` reads the PIN from the FormData, calls
 *    `createNasClient().pair(...)`, and returns a serialisable
 *    `Result<T, E>` so the page can show an error without
 *    throwing.
 *  - `refreshToken` reads the bearer token from the FormData
 *    (or the configured keychain) and calls `createNasClient().refresh()`.
 *  - `downloadFromNas` reads the book id, calls
 *    `downloadBook({...})`, and returns a serialisable
 *    `Result<DownloadBookResult, ErrorMessage>`.
 *  - `scanLocalFolder` reads the folder path and dispatches to
 *    the local scan pipeline.
 *
 * Each test mocks the underlying library call (`createNasClient`
 * or `downloadBook`) via `vi.mock` so the server action stays a
 * thin RSC adapter.
 */

interface ActionResult<T> {
  ok: boolean
  value?: T
  error?: { code: string; message: string }
}

const nasClientMock = {
  pair: vi.fn(),
  refresh: vi.fn(),
  listBooks: vi.fn(),
  getBook: vi.fn(),
  search: vi.fn(),
  listCategories: vi.fn(),
  getDiscoveryInfo: vi.fn(),
  getDiscoveryNetwork: vi.fn(),
  startDownload: vi.fn(),
  completeDownload: vi.fn(),
  downloadFile: vi.fn(),
}

const createNasClientMock = vi.fn(() => nasClientMock)

const downloadBookMock = vi.fn()
const scanFileMock = vi.fn()

vi.mock('../../../lib/api/nas-client', () => ({
  createNasClient: createNasClientMock,
}))

vi.mock('../../../lib/download/download-flow', () => ({
  downloadBook: downloadBookMock,
}))

vi.mock('../../../lib/scan/local-pipeline', () => ({
  scanFile: scanFileMock,
}))

describe('nas server actions (PR-3C)', () => {
  let tmpDir: string
  let actions: typeof import('../nas-actions')

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'alejandria-actions-'))
    process.env['ALEJANDRIA_DATA_DIR'] = tmpDir
    vi.clearAllMocks()
    createNasClientMock.mockReturnValue(nasClientMock)
    // Re-import the module after each reset so the mock state is
    // consistent across tests.
    actions = await import('../nas-actions')
  })

  afterEach(() => {
    delete process.env['ALEJANDRIA_DATA_DIR']
    rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('pairDevice', () => {
    it('POSTs the PIN + device name to the NAS and returns the result', async () => {
      nasClientMock.pair.mockResolvedValue({
        token: 'jwt-1',
        expires_at: '2026-12-31T23:59:59Z',
        device_id: 'device-1',
      })

      const fd = new FormData()
      fd.set('pin', '123456')
      fd.set('deviceName', 'MacBook Pro')
      const result = (await actions.pairDevice(fd)) as ActionResult<{
        token: string
        device_id: string
      }>

      expect(result.ok).toBe(true)
      expect(result.value?.token).toBe('jwt-1')
      expect(nasClientMock.pair).toHaveBeenCalledWith({
        pin: '123456',
        deviceName: 'MacBook Pro',
      })
    })

    it('returns a structured error when the NAS rejects the PIN', async () => {
      nasClientMock.pair.mockRejectedValue(
        Object.assign(new Error('401 INVALID_PIN: bad pin'), {
          status: 401,
          code: 'INVALID_PIN',
        }),
      )

      const fd = new FormData()
      fd.set('pin', '000000')
      fd.set('deviceName', 'iPad')
      const result = (await actions.pairDevice(fd)) as ActionResult<unknown>

      expect(result.ok).toBe(false)
      expect(result.error?.code).toBe('INVALID_PIN')
    })

    it('rejects when the PIN field is empty', async () => {
      const fd = new FormData()
      fd.set('pin', '')
      fd.set('deviceName', 'iPad')
      const result = (await actions.pairDevice(fd)) as ActionResult<unknown>

      expect(result.ok).toBe(false)
      expect(result.error?.code).toBe('VALIDATION')
    })
  })

  describe('refreshToken', () => {
    it('rotates the bearer token', async () => {
      nasClientMock.refresh.mockResolvedValue({
        token: 'jwt-2',
        expires_at: '2027-01-01T00:00:00Z',
        device_id: 'device-1',
      })

      const fd = new FormData()
      fd.set('token', 'jwt-1')
      // The action is expected to read the token from a
      // `cookies()` / `headers()`-backed helper, but the test
      // variant simply honours the FormData field when present.
      const result = (await actions.refreshToken(fd)) as ActionResult<{
        token: string
      }>

      expect(result.ok).toBe(true)
      expect(result.value?.token).toBe('jwt-2')
    })
  })

  describe('downloadFromNas', () => {
    it('composes the download flow and returns the persisted path', async () => {
      downloadBookMock.mockResolvedValue({
        book: { id: 7, title: 'Ficciones', author_id: 1, year: 1944, language: 'es' },
        downloadId: 99,
        filePath: join(tmpDir, 'ficciones.pdf'),
        bytesTransferred: 1000,
        tracking: { id: 99, completed: true },
        trackingStart: { download_id: 99, resume_supported: true },
      })

      const fd = new FormData()
      fd.set('bookId', '7')
      fd.set('deviceId', 'device-1')
      fd.set('deviceName', 'iPad')
      fd.set('userId', 'user-1')
      const result = (await actions.downloadFromNas(fd)) as ActionResult<{
        downloadId: number
        filePath: string
      }>

      expect(result.ok).toBe(true)
      expect(result.value?.downloadId).toBe(99)
      expect(downloadBookMock).toHaveBeenCalledTimes(1)
    })

    it('returns a structured error when the flow rejects', async () => {
      downloadBookMock.mockRejectedValue(new Error('network down'))

      const fd = new FormData()
      fd.set('bookId', '7')
      fd.set('deviceId', 'device-1')
      fd.set('deviceName', 'iPad')
      fd.set('userId', 'user-1')
      const result = (await actions.downloadFromNas(fd)) as ActionResult<unknown>

      expect(result.ok).toBe(false)
      expect(result.error?.message).toMatch(/network down/)
    })
  })

  describe('scanLocalFolder', () => {
    it('dispatches to the scan pipeline with the file path', async () => {
      scanFileMock.mockResolvedValue({
        id: 'book-1',
        title: 'Rayuela',
        author: 'Julio Cortázar',
        year: 1963,
        format: 'epub',
        filePath: '/library/rayuela.epub',
        contentHash: 'sha256:rayuela',
        excerpt: '',
      })

      const fd = new FormData()
      fd.set('filePath', '/library/rayuela.epub')
      const result = (await actions.scanLocalFolder(fd)) as ActionResult<{
        id: string
        title: string
      }>

      expect(result.ok).toBe(true)
      expect(result.value?.id).toBe('book-1')
      expect(scanFileMock).toHaveBeenCalledWith('/library/rayuela.epub')
    })
  })
})
