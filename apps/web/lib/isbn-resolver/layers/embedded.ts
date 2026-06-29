/**
 * Layer 1 of the 7-layer ISBN chain — embedded metadata
 * (PR-4A, issue #71).
 *
 * Looks for an ISBN already declared by the file itself:
 *  - PDF: `dc:identifier` in the XMP packet or in the
 *    Info dictionary, normalized via `validate.normalizeIsbn`.
 *  - EPUB: the OPF `package > metadata > dc:identifier`
 *    elements; we read the package file referenced by
 *    `META-INF/container.xml`.
 *
 * Returns the first normalized ISBN-13 candidate, or
 * `null` on miss / parse error. This layer NEVER throws —
 * a corrupt PDF or zip is treated as "no ISBN" and the
 * chain moves to layer 2.
 *
 * The `scanOpfForIsbn` helper is exported because it is
 * a pure string-in / string-out function and is the only
 * thing worth unit testing in isolation (zip parsing
 * belongs in an integration test in PR-3, not here).
 */

import { promises as fs } from 'node:fs'
import { Readable } from 'node:stream'

import {
  getDocument,
  type PDFDocumentProxy,
} from 'pdfjs-dist'

import type { BookInput, IsbnCandidate, LayerContext } from '../types'
import { normalizeIsbn } from '../validate'

/**
 * Public entry point. Returns the embedded ISBN candidate
 * or `null` if the file has none.
 */
export async function extractEmbeddedIsbn(
  book: BookInput,
  ctx: LayerContext,
): Promise<IsbnCandidate | null> {
  try {
    if (book.format === 'pdf') {
      return await extractFromPdf(book, ctx)
    }
    if (book.format === 'epub') {
      return await extractFromEpub(book, ctx)
    }
    return null
  } catch {
    return null
  }
}

/**
 * Pure helper exposed for unit tests: scan an OPF XML
 * string for the first ISBN-shaped `<dc:identifier>`.
 * Returns the normalized ISBN-13 or `null`.
 */
export function scanOpfForIsbn(opfXml: string): string | null {
  // Cheap tag-scanner: we only need the text of <dc:identifier>
  // elements. A full XML parser would handle namespaces and
  // entity refs more robustly, but OPF identifier content is
  // either a literal URN / ISBN / URL — never something that
  // contains `<` or `&` in practice.
  const re = /<dc:identifier\b[^>]*>([^<]*)<\/dc:identifier>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(opfXml)) !== null) {
    const text = (m[1] ?? '').trim()
    const normalized = normalizeIdentifierText(text)
    if (normalized) return normalized
  }
  return null
}

/**
 * Identifier values from XMP / OPF may carry a `urn:isbn:`
 * prefix or be wrapped in quotes. Strip the well-known
 * prefixes and let `normalizeIsbn` do the rest.
 */
function normalizeIdentifierText(text: string): string | null {
  if (!text) return null
  // Strip well-known URN prefixes.
  const stripped = text.replace(/^urn:isbn:/i, '').trim()
  // Strip surrounding quotes (some XMP packets quote the value).
  const unquoted = stripped.replace(/^["']|["']$/g, '')
  return normalizeIsbn(unquoted)
}

// ---------------------------------------------------------------------------
// PDF path
// ---------------------------------------------------------------------------

async function extractFromPdf(
  book: BookInput,
  _ctx: LayerContext,
): Promise<IsbnCandidate | null> {
  let doc: PDFDocumentProxy
  try {
    const data = await fs.readFile(book.filePath)
    // pdfjs consumes an ArrayBuffer / Uint8Array in Node.
    const ab = data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    )
    doc = await getDocument({
      data: ab,
      // We never render pages, so we can skip the worker.
      disableWorker: true,
      isEvalSupported: false,
      verbosity: 0,
    }).promise
  } catch {
    return null
  }
  try {
    const meta = await doc.getMetadata()
    const candidates: string[] = []
    // Shape 1: pdfjs `metadata.getAll()` with a dc:identifier key.
    const all = (meta.metadata?.getAll?.() ?? {}) as Record<string, unknown>
    for (const value of Object.values(all)) {
      pushIfIsbn(candidates, value)
    }
    // Shape 2: raw XMP packet on `meta.getXmp().packet`.
    const xmp = (meta as unknown as { getXmp?: () => { packet?: string } })
      .getXmp?.()
      ?.packet
    if (xmp) scanXmpForIsbn(xmp, candidates)
    const first = candidates[0]
    if (!first) return null
    return {
      isbn: first,
      source: 'embedded',
      confidence: 1,
      raw: { info: meta.info, all },
    }
  } catch {
    return null
  } finally {
    try {
      await doc.destroy()
    } catch {
      // best-effort
    }
  }
}

function pushIfIsbn(out: string[], value: unknown): void {
  if (typeof value === 'string') {
    const norm = normalizeIdentifierText(value)
    if (norm) out.push(norm)
    return
  }
  if (Array.isArray(value)) {
    for (const v of value) pushIfIsbn(out, v)
  }
}

/**
 * Walk an XMP packet for `<dc:identifier>` elements. The
 * raw packet is XML; we apply the same cheap tag-scan we
 * use for OPF and let `normalizeIsbn` reject anything that
 * is not a real ISBN.
 */
function scanXmpForIsbn(xmp: string, out: string[]): void {
  const re = /<dc:identifier\b[^>]*>([\s\S]*?)<\/dc:identifier>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(xmp)) !== null) {
    const text = (m[1] ?? '').trim()
    const norm = normalizeIdentifierText(text)
    if (norm) out.push(norm)
  }
}

// ---------------------------------------------------------------------------
// EPUB path
// ---------------------------------------------------------------------------

async function extractFromEpub(
  book: BookInput,
  _ctx: LayerContext,
): Promise<IsbnCandidate | null> {
  try {
    const buf = await fs.readFile(book.filePath)
    const opfXml = await readOpfFromEpub(buf)
    if (!opfXml) return null
    const isbn = scanOpfForIsbn(opfXml)
    if (!isbn) return null
    return { isbn, source: 'embedded', confidence: 1, raw: { opfXml } }
  } catch {
    return null
  }
}

/**
 * Locate the OPF package document inside an EPUB zip and
 * return its text. We implement a minimal local-file-header
 * scan to avoid pulling in a full zip library — every entry
 * we care about is stored uncompressed (method 0) in a
 * standards-compliant EPUB, and we only need the first
 * match.
 */
async function readOpfFromEpub(buf: Uint8Array): Promise<string | null> {
  // 1. Read META-INF/container.xml from the zip.
  const containerXml = await readEpubEntry(buf, 'META-INF/container.xml')
  if (!containerXml) return null
  const opfPath = parseContainerForOpfPath(containerXml)
  if (!opfPath) return null
  // 2. Read the OPF package document.
  return await readEpubEntry(buf, opfPath)
}

/** Tiny regex over the container.xml — we only need the rootfile path. */
function parseContainerForOpfPath(containerXml: string): string | null {
  const m = /<rootfile\b[^>]*full-path="([^"]+)"/i.exec(containerXml)
  return m && m[1] ? m[1] : null
}

/**
 * Return the text of a single zip entry by name. Implements
 * the minimum of the ZIP spec needed to read a stored
 * (method 0) entry; deflate entries (method 8) are out of
 * scope for now and produce `null` so the layer falls back
 * to the regex layer.
 */
async function readEpubEntry(
  buf: Uint8Array,
  targetName: string,
): Promise<string | null> {
  const target = targetName.replace(/\\/g, '/')
  // Walk the local file headers from offset 0.
  let offset = 0
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const decoder = new TextDecoder('utf-8')
  while (offset + 30 <= buf.length) {
    const sig = view.getUint32(offset, true)
    if (sig !== 0x04034b50) return null // not a local header
    const nameLen = view.getUint16(offset + 26, true)
    const extraLen = view.getUint16(offset + 28, true)
    const compLen = view.getUint32(offset + 18, true)
    const uncompLen = view.getUint32(offset + 22, true)
    const method = view.getUint16(offset + 8, true)
    const name = decoder.decode(buf.subarray(offset + 30, offset + 30 + nameLen))
    const dataStart = offset + 30 + nameLen + extraLen
    if (name === target) {
      if (method === 0) {
        return decoder.decode(buf.subarray(dataStart, dataStart + compLen))
      }
      if (method === 8) {
        // Deflate: use Node's zlib via Readable.from.
        const { createInflateRaw } = await import('node:zlib')
        const stream = Readable.from(buf.subarray(dataStart, dataStart + compLen))
        const inflated = await new Promise<Buffer>((resolve, reject) => {
          const chunks: Buffer[] = []
          stream
            .pipe(createInflateRaw())
            .on('data', (c: Buffer) => chunks.push(c))
            .on('end', () => resolve(Buffer.concat(chunks)))
            .on('error', reject)
        })
        return inflated.toString('utf-8')
      }
      return null
    }
    offset = dataStart + compLen
    // uncompLen is unused here but kept for readability; some
    // archives need it to skip data descriptors (general bit 3).
    void uncompLen
  }
  return null
}
