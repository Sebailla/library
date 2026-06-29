import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * TDD tests for the observability wiring (PR-3-fix-C, #61).
 *
 * Every catch block in the four modules under test must call
 * `logError(scope, err, { context })` so the structured logger
 * captures the failure with the scope that owns the code path.
 *
 * Tests mock `@/lib/log` so the wiring can be verified without
 * touching the console writer (which is shared with jsdom +
 * React Testing Library and would produce noisy output).
 *
 * Each test asserts both:
 *  - the original error still propagates (so the existing
 *    error contract is preserved), and
 *  - logError was called with the expected scope + context.
 */

const logErrorMock = vi.fn()

vi.mock('@/lib/log', () => ({
  logError: logErrorMock,
  info: vi.fn(),
  warn: vi.fn(),
}))

beforeEach(() => {
  logErrorMock.mockReset()
})

describe('scan pipeline wiring (PR-3-fix-C, #61)', () => {
  it('logs and rethrows when the sidecar returns invalid JSON', async () => {
    const scanModule = await import('../../../lib/scan/local-pipeline')
    const spawn = async () => ({
      exitCode: 0,
      stdout: 'not json',
      stderr: '',
    })
    await expect(
      scanModule.scanFile('foo.epub', {
        spawn,
        libraryRoot: '/tmp',
      }),
    ).rejects.toThrow(/invalid JSON/i)
    expect(logErrorMock).toHaveBeenCalledTimes(1)
    const [scope, err, ctx] = logErrorMock.mock.calls[0]!
    expect(scope).toBe('scan')
    expect(err).toBeInstanceOf(Error)
    expect(ctx).toMatchObject({ stage: 'envelope-parse' })
  })
})

describe('NAS client wiring (PR-3-fix-C, #61)', () => {
  it('logs and rethrows when the JSON error body fails to parse', async () => {
    const { createNasClient } = await import('../../../lib/api/nas-client')
    const fetchImpl = vi.fn(async () =>
      new Response('this is not json', { status: 500, headers: { 'content-type': 'application/json' } }),
    )
    const client = createNasClient({ fetch: fetchImpl as unknown as typeof fetch })
    await expect(client.listBooks({})).rejects.toThrow(/NAS request failed: 500/)
    // PR-3-fix-C #61 wires every catch block to logError.
    // The unparsable-error-body branch records the SyntaxError
    // AND the status code so an operator can correlate the
    // parse failure with the upstream HTTP failure.
    expect(logErrorMock).toHaveBeenCalledTimes(1)
    const [scope, err, ctx] = logErrorMock.mock.calls[0]!
    expect(scope).toBe('nas-client')
    expect((err as Error).message).toMatch(/JSON/i)
    expect(ctx).toMatchObject({ stage: 'parse-error-body', status: 500 })
  })
})

describe('NAS server actions wiring (PR-3-fix-C, #61)', () => {
  it('pairDevice logs and returns a structured error when the NAS rejects', async () => {
    vi.resetModules()
    const createNasClientMock = vi.fn(() => ({
      pair: vi.fn(async () => {
        throw Object.assign(new Error('401 INVALID_PIN: bad pin'), {
          status: 401,
          code: 'INVALID_PIN',
        })
      }),
    }))
    vi.doMock('../../../lib/api/nas-client', () => ({
      createNasClient: createNasClientMock,
    }))
    vi.doMock('../../../lib/log', () => ({
      logError: logErrorMock,
      info: vi.fn(),
      warn: vi.fn(),
    }))
    const actions = await import('../nas-actions')
    const fd = new FormData()
    fd.set('pin', '000000')
    fd.set('deviceName', 'iPad')
    const result = await actions.pairDevice(fd)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_PIN')
    }
    expect(logErrorMock).toHaveBeenCalled()
    const [scope, err, ctx] = logErrorMock.mock.calls[0]!
    expect(scope).toBe('nas-actions.pairDevice')
    expect(err).toBeInstanceOf(Error)
    expect(ctx).toMatchObject({ code: 'INVALID_PIN' })
  })

  it('downloadFromNas logs and returns a structured error when the flow throws', async () => {
    vi.resetModules()
    const createNasClientMock = vi.fn(() => ({}))
    const downloadBookMock = vi.fn(async () => {
      throw new Error('network down')
    })
    vi.doMock('../../../lib/api/nas-client', () => ({
      createNasClient: createNasClientMock,
    }))
    vi.doMock('../../../lib/download/download-flow', () => ({
      downloadBook: downloadBookMock,
    }))
    vi.doMock('../../../lib/log', () => ({
      logError: logErrorMock,
      info: vi.fn(),
      warn: vi.fn(),
    }))
    const actions = await import('../nas-actions')
    const fd = new FormData()
    fd.set('bookId', '7')
    fd.set('deviceId', 'device-1')
    fd.set('deviceName', 'iPad')
    fd.set('userId', 'user-1')
    const result = await actions.downloadFromNas(fd)
    expect(result.ok).toBe(false)
    expect(logErrorMock).toHaveBeenCalled()
    const [scope] = logErrorMock.mock.calls[0]!
    expect(scope).toBe('nas-actions.downloadFromNas')
  })

  it('scanLocalFolder logs and returns a structured error when the scan throws', async () => {
    vi.resetModules()
    const scanFileMock = vi.fn(async () => {
      throw new Error('sidecar exited with code 2')
    })
    vi.doMock('../../../lib/scan/local-pipeline', () => ({
      scanFile: scanFileMock,
    }))
    vi.doMock('../../../lib/log', () => ({
      logError: logErrorMock,
      info: vi.fn(),
      warn: vi.fn(),
    }))
    const actions = await import('../nas-actions')
    const fd = new FormData()
    fd.set('filePath', '/library/rayuela.epub')
    const result = await actions.scanLocalFolder(fd)
    expect(result.ok).toBe(false)
    expect(logErrorMock).toHaveBeenCalled()
    const [scope] = logErrorMock.mock.calls[0]!
    expect(scope).toBe('nas-actions.scanLocalFolder')
  })
})