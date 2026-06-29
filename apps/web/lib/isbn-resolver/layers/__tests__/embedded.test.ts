/**
 * TDD tests for `lib/isbn-resolver/layers/embedded.ts` (PR-4A, #71).
 *
 * Layer 1 of the 7-layer chain. Looks for an ISBN already
 * embedded in the file's metadata:
 *  - PDF: scan the XMP metadata stream + the Info dictionary
 *    for `dc:identifier` whose value looks like an ISBN.
 *  - EPUB: read the OPF `package > metadata > identifier[*]`
 *    elements and return the first ISBN-shaped value.
 *
 * The layer is a pure function over `(book, ctx)`:
 *  - Returns the first normalized ISBN-13 candidate.
 *  - Returns null when no ISBN-shaped value is present.
 *  - Returns null on parse errors (XMP malformed, OPF zip
 *    unreadable, etc.) — never throws.
 *
 * `pdfjs-dist` is mocked because we don't have a real PDF
 * parser in jsdom. The fs path is exercised with real
 * temp files so we cover the actual on-disk read.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createInMemoryIsbnCache } from '../../cache'
import { extractEmbeddedIsbn, scanOpfForIsbn } from '../embedded'

// Mocks are hoisted above the imports. Use vi.hoisted to
// expose the mock handles so we can configure them inside
// describe / beforeEach blocks.
const { mockGetMetadata, mockGetDocument } = vi.hoisted(() => {
  const getMetadata = vi.fn()
  const getDocument = vi.fn(() => ({
    promise: Promise.resolve({
      getMetadata: getMetadata,
      destroy: () => Promise.resolve(),
    }),
  }))
  return { mockGetMetadata: getMetadata, mockGetDocument: getDocument }
})

vi.mock('pdfjs-dist', () => ({
  getDocument: () => mockGetDocument(),
  GlobalWorkerOptions: { workerSrc: '' },
}))

function makeCtx() {
  return { cache: createInMemoryIsbnCache() }
}

const baseBook = (filePath: string) => ({
  title: 'Test',
  author: 'Tester',
  format: 'pdf' as const,
  filePath,
})

const epubBook = (filePath: string) => ({
  title: 'Test',
  author: 'Tester',
  format: 'epub' as const,
  filePath,
})

let tmpDir: string

beforeEach(async () => {
  mockGetMetadata.mockReset()
  mockGetDocument.mockClear()
  tmpDir = await mkdtemp(join(tmpdir(), 'isbn-embedded-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe('isbn-resolver/layers/embedded (PR-4A, #71)', () => {
  describe('PDF path (pdfjs-dist)', () => {
    it('returns the ISBN from dc:identifier when it is valid ISBN-13', async () => {
      const filePath = join(tmpDir, 'a.pdf')
      await writeFile(filePath, Buffer.from('%PDF-1.4 fake'))
      mockGetMetadata.mockResolvedValue({
        info: { Title: 'X' },
        metadata: {
          getAll: () => ({
            'dc:identifier': 'urn:isbn:9780306406157',
          }),
        },
      })
      const result = await extractEmbeddedIsbn(baseBook(filePath), makeCtx())
      expect(result).toEqual({
        isbn: '9780306406157',
        source: 'embedded',
        confidence: 1,
        raw: expect.anything(),
      })
    })

    it('normalizes ISBN-10 from dc:identifier to ISBN-13', async () => {
      const filePath = join(tmpDir, 'b.pdf')
      await writeFile(filePath, Buffer.from('%PDF-1.4 fake'))
      mockGetMetadata.mockResolvedValue({
        info: {},
        metadata: {
          getAll: () => ({
            'dc:identifier': 'urn:isbn:0306406152',
          }),
        },
      })
      const result = await extractEmbeddedIsbn(baseBook(filePath), makeCtx())
      expect(result?.isbn).toBe('9780306406157')
      expect(result?.source).toBe('embedded')
    })

    it('scans the raw XMP packet when dc:identifier is absent', async () => {
      const filePath = join(tmpDir, 'c.pdf')
      await writeFile(filePath, Buffer.from('%PDF-1.4 fake'))
      const xmp = `
        <x:xmpmeta xmlns:x="adobe:ns:meta/">
          <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
                   xmlns:dc="http://purl.org/dc/elements/1.1/">
            <rdf:Description>
              <dc:identifier>978-0-13-409865-4</dc:identifier>
            </rdf:Description>
          </rdf:RDF>
        </x:xmpmeta>
      `
      mockGetMetadata.mockResolvedValue({
        info: {},
        metadata: { getAll: () => ({}) },
        getXmp: () => ({ packet: xmp }),
      })
      const result = await extractEmbeddedIsbn(baseBook(filePath), makeCtx())
      expect(result?.isbn).toBe('9780134098654')
    })

    it('returns null when no ISBN-shaped identifier is present', async () => {
      const filePath = join(tmpDir, 'd.pdf')
      await writeFile(filePath, Buffer.from('%PDF-1.4 fake'))
      mockGetMetadata.mockResolvedValue({
        info: {},
        metadata: {
          getAll: () => ({
            'dc:identifier': 'https://example.com/book/123',
          }),
        },
      })
      const result = await extractEmbeddedIsbn(baseBook(filePath), makeCtx())
      expect(result).toBeNull()
    })

    it('returns null when pdfjs throws (file unreadable)', async () => {
      const filePath = join(tmpDir, 'e.pdf')
      await writeFile(filePath, Buffer.from('%PDF-1.4 fake'))
      mockGetDocument.mockImplementationOnce(() => ({
        promise: Promise.reject(new Error('corrupt pdf')),
      }))
      const result = await extractEmbeddedIsbn(baseBook(filePath), makeCtx())
      expect(result).toBeNull()
    })
  })

  describe('EPUB path (OPF scan)', () => {
    it('returns the ISBN from the OPF identifier when valid ISBN-13', async () => {
      const opf =
        '<?xml version="1.0" encoding="utf-8"?>' +
        '<package xmlns="http://www.idpf.org/2007/opf" version="3.0">' +
        '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">' +
        '<dc:identifier id="isbn">urn:isbn:9780306406157</dc:identifier>' +
        '<dc:title>Test</dc:title></metadata>' +
        '<manifest><item id="c" href="content.xhtml"/></manifest>' +
        '</package>'
      const filePath = join(tmpDir, 'book.epub')
      const buf = buildEpubBuffer({
        'META-INF/container.xml':
          '<?xml version="1.0"?>' +
          '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">' +
          '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>' +
          '</rootfiles></container>',
        'OEBPS/content.opf': opf,
      })
      await writeFile(filePath, buf)
      const result = await extractEmbeddedIsbn(epubBook(filePath), makeCtx())
      expect(result?.isbn).toBe('9780306406157')
      expect(result?.source).toBe('embedded')
    })

    it('returns null when the EPUB zip is unreadable', async () => {
      const filePath = join(tmpDir, 'broken.epub')
      await writeFile(filePath, Buffer.from('not a zip'))
      const result = await extractEmbeddedIsbn(epubBook(filePath), makeCtx())
      expect(result).toBeNull()
    })
  })

  describe('scanOpfForIsbn (pure helper)', () => {
    it('returns the ISBN-13 from a URN-wrapped identifier', () => {
      const opf =
        '<package><metadata>' +
        '<dc:identifier>urn:isbn:9780306406157</dc:identifier>' +
        '</metadata></package>'
      expect(scanOpfForIsbn(opf)).toBe('9780306406157')
    })

    it('returns the ISBN-13 from a bare identifier element', () => {
      const opf =
        '<package><metadata>' +
        '<dc:identifier>9780134098654</dc:identifier>' +
        '</metadata></package>'
      expect(scanOpfForIsbn(opf)).toBe('9780134098654')
    })

    it('returns the ISBN-13 from a hyphenated identifier', () => {
      const opf =
        '<package><metadata>' +
        '<dc:identifier>978-0-306-40615-7</dc:identifier>' +
        '</metadata></package>'
      expect(scanOpfForIsbn(opf)).toBe('9780306406157')
    })

    it('returns null when no ISBN is present', () => {
      const opf =
        '<package><metadata>' +
        '<dc:identifier>https://example.com/x</dc:identifier>' +
        '</metadata></package>'
      expect(scanOpfForIsbn(opf)).toBeNull()
    })

    it('returns null on malformed XML', () => {
      expect(scanOpfForIsbn('<<< not xml >>>')).toBeNull()
    })

    it('skips non-ISBN identifiers and finds one that is', () => {
      const opf =
        '<package><metadata>' +
        '<dc:identifier>https://example.com/x</dc:identifier>' +
        '<dc:identifier id="isbn">urn:isbn:9780306406157</dc:identifier>' +
        '</metadata></package>'
      expect(scanOpfForIsbn(opf)).toBe('9780306406157')
    })
  })

  describe('format short-circuit', () => {
    it('returns null for an unsupported format (jpg)', async () => {
      const result = await extractEmbeddedIsbn(
        { title: 'X', format: 'jpg', filePath: '/x.jpg' },
        makeCtx(),
      )
      expect(result).toBeNull()
    })
  })
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal ZIP archive that contains the given
 * (path, contents) pairs. The archive is uncompressed
 * (method 0) to keep the helper dependency-free — good
 * enough for unit tests where we never roundtrip the
 * archive through another zip library.
 */
function buildEpubBuffer(
  files: Record<string, string>,
): Uint8Array {
  const encoder = new TextEncoder()
  const entries = Object.entries(files)
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0
  for (const [name, content] of entries) {
    const nameBytes = encoder.encode(name)
    const data = encoder.encode(content)
    const crc = 0
    const local = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(6, 0, true)
    lv.setUint16(8, 0, true)
    lv.setUint16(10, 0, true)
    lv.setUint16(12, 0, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, data.length, true)
    lv.setUint32(22, data.length, true)
    lv.setUint16(26, nameBytes.length, true)
    lv.setUint16(28, 0, true)
    local.set(nameBytes, 30)
    localParts.push(local, data)
    const central = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0, true)
    cv.setUint16(10, 0, true)
    cv.setUint16(12, 0, true)
    cv.setUint16(14, 0, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, data.length, true)
    cv.setUint32(24, data.length, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint16(30, 0, true)
    cv.setUint16(32, 0, true)
    cv.setUint16(34, 0, true)
    cv.setUint16(36, 0, true)
    cv.setUint32(38, 0, true)
    cv.setUint32(42, offset, true)
    central.set(nameBytes, 46)
    centralParts.push(central)
    offset += local.length + data.length
  }
  const centralOffset = offset
  let centralSize = 0
  for (const c of centralParts) centralSize += c.length
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(4, 0, true)
  ev.setUint16(6, 0, true)
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, centralOffset, true)
  ev.setUint16(20, 0, true)
  const out = new Uint8Array(
    localParts.reduce((s, p) => s + p.length, 0) +
      centralSize +
      eocd.length,
  )
  let pos = 0
  for (const p of localParts) {
    out.set(p, pos)
    pos += p.length
  }
  for (const c of centralParts) {
    out.set(c, pos)
    pos += c.length
  }
  out.set(eocd, pos)
  return out
}
