import { describe, expect, it, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * TDD integration tests for `src/downloader.ts` (PR-N8, issue #94).
 *
 * Scope: the downloader talks to the NAS over HTTP. We exercise it
 * against a sandboxed HTTP server that mimics the four endpoints the
 * real `services/nas-backend` exposes (PR-2D/E + PR-N1):
 *
 *   GET  /api/books?page=N&limit=M           → NasListBooksResponse
 *   POST /api/downloads                      → NasStartDownloadResponse
 *   GET  /api/files/:id                      → bytes (Range-aware)
 *   PATCH /api/downloads/:id                 → NasCompleteDownloadResponse
 *
 * The downloader is the bridge between the mac IPC layer (PR-4C) and
 * the NAS. It MUST:
 *
 *   1. Wire through native `fetch` (the running Node has it) — no
 *      third-party HTTP client.
 *   2. Resolve its base URL from `ALEJANDRIA_NAS_URL` (default
 *      `http://localhost:3000`, override per-call via constructor).
 *   3. Honour the bearer token when one is provided.
 *   4. Surface 4xx / 5xx responses as descriptive `Error`s so the
 *      IPC layer can pass them to the renderer.
 *   5. Stream the download body to disk via a per-chunk writer and
 *      emit the NAS completion envelope when the bytes hit disk.
 */

interface ListBooksResponse {
  data: readonly { id: number; title: string; format: string }[]
  page: number
  limit: number
  total: number
}

interface StartDownloadResponse {
  download_id: number
  resume_supported: boolean
}

interface CompleteDownloadResponse {
  id: number
  completed: boolean
  bytes_transferred: number
  book_id: number
  device_id: string | null
  downloaded_at: string
}

const FILE_BODY = Buffer.from('ABCDEF1234567890', 'utf8')

class SandboxNas {
  readonly #server: Server
  #port: number
  /** Per-test state the handlers read. */
  #lastStartDownload: { book_id: number; token: string | null } | null = null
  #lastCompleteDownload: { id: number; bytes_transferred: number; token: string | null } | null = null
  #listBooksCalled = 0
  #fileDownloadsServed = 0

  constructor() {
    this.#port = 0
    this.#server = createServer((req, res) => this.#handle(req, res))
  }

  start(): Promise<void> {
    return new Promise((resolve) =>
      this.#server.listen(this.#port, '127.0.0.1', () => {
        const addr = this.#server.address() as { port: number } | null
        this.#port = addr?.port ?? 0
        resolve()
      }),
    )
  }

  stop(): Promise<void> {
    return new Promise((resolve) => this.#server.close(() => resolve()))
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this.#port}`
  }

  get lastStartDownload() {
    return this.#lastStartDownload
  }

  get lastCompleteDownload() {
    return this.#lastCompleteDownload
  }

  get listBooksCalls() {
    return this.#listBooksCalled
  }

  get fileDownloadsServed() {
    return this.#fileDownloadsServed
  }

  #handle(req: IncomingMessage, res: ServerResponse): void {
    const auth = req.headers.authorization ?? null
    const url = req.url ?? '/'

    if (req.method === 'GET' && url.startsWith('/api/books')) {
      this.#listBooksCalled++
      const payload: ListBooksResponse = {
        data: [
          { id: 1, title: 'Rayuela', format: 'epub' },
          { id: 2, title: 'Ficciones', format: 'pdf' },
        ],
        page: 1,
        limit: 50,
        total: 2,
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(payload))
      return
    }

    if (req.method === 'POST' && url === '/api/downloads') {
      let body = ''
      req.on('data', (c: Buffer) => (body += c.toString('utf8')))
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body) as { book_id: number }
          this.#lastStartDownload = { book_id: parsed.book_id, token: auth }
        } catch {
          /* ignore */
        }
        const payload: StartDownloadResponse = { download_id: 777, resume_supported: true }
        res.writeHead(201, { 'content-type': 'application/json' })
        res.end(JSON.stringify(payload))
      })
      return
    }

    if (req.method === 'GET' && url.startsWith('/api/files/')) {
      this.#fileDownloadsServed++
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(FILE_BODY.byteLength),
      })
      res.end(FILE_BODY)
      return
    }

    if (req.method === 'PATCH' && /^\/api\/downloads\/\d+/.test(url)) {
      const idMatch = url.match(/^\/api\/downloads\/(\d+)/)
      let body = ''
      req.on('data', (c: Buffer) => (body += c.toString('utf8')))
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body) as { bytes_transferred: number }
          this.#lastCompleteDownload = {
            id: idMatch ? Number(idMatch[1]) : -1,
            bytes_transferred: parsed.bytes_transferred,
            token: auth,
          }
        } catch {
          /* ignore */
        }
        const payload: CompleteDownloadResponse = {
          id: idMatch ? Number(idMatch[1]) : 777,
          completed: true,
          bytes_transferred: FILE_BODY.byteLength,
          book_id: 1,
          device_id: null,
          downloaded_at: '2026-06-30T00:00:00Z',
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(payload))
      })
      return
    }

    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: `no route for ${req.method} ${url}` } }))
  }
}

describe('downloader (PR-N8, real fetch against sandboxed NAS)', () => {
  let nas: SandboxNas
  let workDir: string

  beforeAll(async () => {
    nas = new SandboxNas()
    await nas.start()
  })

  afterAll(async () => {
    await nas.stop()
  })

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'alejandria-mac-downloader-'))
  })

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true })
  })

  it('listBooks() hits /api/books and returns the typed payload', async () => {
    const { createNasDownloader, NasDownloader } = await import('../src/downloader')
    const dl = createNasDownloader({ baseUrl: nas.baseUrl })
    const books = await dl.listBooks({ page: 1, limit: 50 })
    expect(books.data).toHaveLength(2)
    expect(books.data[0]).toMatchObject({ id: 1, title: 'Rayuela', format: 'epub' })
    expect(books.total).toBe(2)
    expect(nas.listBooksCalls).toBe(1)
    // Sanity: the type is exported so the IPC layer can typecheck against it.
    expect(typeof NasDownloader).toBe('function')
  })

  it('download(bookId) starts a download, fetches the file, and completes the download', async () => {
    const { createNasDownloader } = await import('../src/downloader')
    const dest = join(workDir, 'book.bin')
    const dl = createNasDownloader({ baseUrl: nas.baseUrl, deviceId: 'dev-1', userId: 'user-1' })

    const result = await dl.download(1, dest)

    // Start envelope was sent with the right bookId
    expect(nas.lastStartDownload?.book_id).toBe(1)
    // File was written to the chosen dest path
    expect(existsSync(dest)).toBe(true)
    expect(readFileSync(dest, 'utf8')).toBe(FILE_BODY.toString('utf8'))
    // Completion envelope was sent with the bytes we transferred
    expect(nas.lastCompleteDownload?.bytes_transferred).toBe(FILE_BODY.byteLength)
    expect(nas.lastCompleteDownload?.id).toBe(777)
    // File endpoint served exactly one Range request
    expect(nas.fileDownloadsServed).toBe(1)
    // Returned shape includes the completion acknowledgement
    expect(result).toMatchObject({
      ok: true,
      bookId: 1,
      bytesTransferred: FILE_BODY.byteLength,
      downloadId: 777,
      transport: 'nas',
    })
  })

  it('download() forwards the bearer token when one is configured', async () => {
    const { createNasDownloader } = await import('../src/downloader')
    const dest = join(workDir, 'book.bin')
    const dl = createNasDownloader({ baseUrl: nas.baseUrl, token: 'tok-XYZ' })

    await dl.download(1, dest)

    expect(nas.lastStartDownload?.token).toBe('Bearer tok-XYZ')
    expect(nas.lastCompleteDownload?.token).toBe('Bearer tok-XYZ')
  })

  it('download() surfaces a 5xx NAS error as a descriptive Error', async () => {
    // Spin up a one-route server that always 500s. Reusing the same
    // test isolation: the standalone server is bound, hit, then
    // closed inside this case.
    const errServer = createServer((_req, res) => {
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { code: 'NAS_DOWN', message: 'storage offline' } }))
    })
    await new Promise<void>((r) => errServer.listen(0, '127.0.0.1', r))
    const port = (errServer.address() as { port: number }).port

    const { createNasDownloader } = await import('../src/downloader')
    const dl = createNasDownloader({ baseUrl: `http://127.0.0.1:${port}` })

    await expect(dl.listBooks({ page: 1, limit: 10 })).rejects.toThrow(/nas/i)
    await new Promise<void>((r) => errServer.close(() => r()))
  })
})
