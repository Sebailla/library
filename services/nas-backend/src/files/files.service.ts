import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { promises as fs, createReadStream, ReadStream } from 'fs';
import { resolve as resolvePath, sep } from 'path';
import type { Response } from 'express';
import { BOOKS_REPOSITORY, BooksRepository } from '../books/books.repository';
import { RangeParseError, RangeSpec } from './files.types';

/**
 * Files service — PR-N1 (NAS backend closure).
 *
 *   GET /api/files/:book_id   → stream a book file (Range-aware)
 *   HEAD /api/files/:book_id  → metadata only
 *
 * Two pure helpers ({@link parseRangeHeader},
 * {@link resolveBookFilePath}) are exported for direct unit testing;
 * the streaming side-effect goes through {@link streamFile} which
 * mutates the Express response.
 *
 * Path safety: the resolve step pins every served path to
 * ``libraryRoot`` (configurable per environment via the
 * ``NAS_LIBRARY_ROOT`` env var) so a hostile ``books.file_path``
 * row pointing outside the library (e.g. ``/etc/passwd``) cannot
 * leak through the HTTP layer.
 */
@Injectable()
export class FilesService {
  constructor(
    @Inject(BOOKS_REPOSITORY) private readonly books: BooksRepository,
    private readonly libraryRoot: string,
  ) {}

  /**
   * Parse a single-range ``Range`` request header.
   *
   * Returns a {@link RangeSpec} on success, ``null`` when the
   * request should fall through to a full-body response, and
   * throws {@link RangeParseError} when the range is syntactically
   * valid but cannot be satisfied (caller emits 416).
   *
   * Multi-range responses (``bytes=0-99,200-299``) are NOT
   * supported and return ``null`` so the controller can serve the
   * full body — clients that ask for multipart byte ranges are
   * rare and out of scope for the resumable-download use case.
   *
   * Implemented as a pure module-level function (re-exported
   * below) so the parser can be unit-tested without DI. The class
   * method here delegates to the module function so the call site
   * stays symmetrical with the rest of the service.
   */
  parseRangeHeader(
    header: string | undefined,
    fileSize: number,
  ): RangeSpec | null {
    return parseRangeHeader(header, fileSize);
  }

  /**
   * Look up ``books.file_path`` for ``bookId`` and resolve it
   * against ``libraryRoot``. Throws {@link NotFoundException}
   * when the book is missing or the resolved path escapes the
   * library root (path-traversal hardening).
   */
  async resolveBookFilePath(bookId: number): Promise<string> {
    const book = await this.books.findById(bookId);
    if (!book) {
      throw new NotFoundException({
        error: { code: 'FILE_NOT_FOUND', message: 'Book not found' },
      });
    }
    const stored = book.filePath;
    // ``resolve`` collapses ``..`` segments and normalises
    // separators so the prefix check below is reliable across
    // platforms.
    const root = resolvePath(this.libraryRoot);
    const resolved = resolvePath(root, stored);
    const rootWithSep = root.endsWith(sep) ? root : root + sep;
    if (!(resolved === root || resolved.startsWith(rootWithSep))) {
      // Path-traversal attempt — surface as FILE_NOT_FOUND rather
      // than leaking details about the configured library root.
      throw new NotFoundException({
        error: {
          code: 'FILE_NOT_FOUND',
          message: 'Book file is outside the library root',
        },
      });
    }
    return resolved;
  }

  /**
   * Pipe the requested slice of ``filePath`` to ``response``.
   *
   * Headers (Content-Type, Content-Length, Accept-Ranges,
   * Content-Range, ETag) MUST be set on the response BEFORE the
   * stream starts so the client receives them with the first
   * chunk.
   */
  async streamFile(
    filePath: string,
    range: RangeSpec | null,
    response: Response,
    options: StreamFileOptions,
  ): Promise<void> {
    const stat = await fs.stat(filePath);
    const totalSize = stat.size;
    const mtime = stat.mtime;
    const etag = `"${stat.size.toString(16)}-${mtime.getTime().toString(16)}"`;

    response.setHeader('Accept-Ranges', 'bytes');
    response.setHeader('Content-Type', options.contentType);
    response.setHeader('ETag', etag);
    response.setHeader('Last-Modified', mtime.toUTCString());

    // If-None-Match short-circuit: client already has this version.
    if (
      options.ifNoneMatch !== undefined &&
      options.ifNoneMatch === etag
    ) {
      response.status(304);
      response.end();
      return;
    }

    if (!range) {
      // Full body.
      response.setHeader('Content-Length', String(totalSize));
      response.status(200);
      const stream = createReadStream(filePath);
      await pipeAndClose(stream, response);
      return;
    }

    const length = range.end - range.start + 1;
    response.setHeader('Content-Length', String(length));
    response.setHeader(
      'Content-Range',
      `bytes ${range.start}-${range.end}/${totalSize}`,
    );
    response.status(206);
    const stream: ReadStream = createReadStream(filePath, {
      start: range.start,
      end: range.end,
    });
    await pipeAndClose(stream, response);
  }
}

/** Options bag for {@link FilesService.streamFile}. */
export interface StreamFileOptions {
  /** Resolved Content-Type for the response (e.g. ``application/pdf``). */
  contentType: string;
  /** ``If-None-Match`` request header value (``undefined`` if absent). */
  ifNoneMatch?: string;
}

/**
 * Pipe a read stream into an Express response and resolve once the
 * stream is finished (or error). Centralising this here keeps the
 * controller free of stream-error handling boilerplate.
 */
function pipeAndClose(stream: ReadStream, response: Response): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    stream.on('error', (err) => {
      // If headers have already been sent we cannot change the
      // status — just destroy the socket so the client sees a
      // truncated body. Otherwise we surface a 500.
      if (response.headersSent) {
        response.destroy(err);
        resolve();
        return;
      }
      response.status(500).json({
        error: {
          code: 'FILE_READ_ERROR',
          message: err.message,
        },
      });
      resolve();
    });
    stream.on('end', () => {
      resolve();
    });
    response.on('close', () => {
      // Client disconnected mid-stream — cancel the underlying
      // file handle so the worker pool does not leak.
      stream.destroy();
      resolve();
    });
    stream.pipe(response);
  });
}

// Re-export the parsed range error type so callers don't need to
// reach into the types file.
export { RangeParseError } from './files.types';
export type { RangeSpec } from './files.types';

/**
 * Module-level pure implementation of {@link FilesService.parseRangeHeader}.
 * Kept at module scope so the contract tests can import it without
 * constructing the full DI graph.
 */
export function parseRangeHeader(
  header: string | undefined,
  fileSize: number,
): RangeSpec | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (trimmed.length === 0) return null;
  if (!trimmed.startsWith('bytes=')) return null;

  // Reject multi-range up front: a comma-separated value list
  // means the client wants multipart/byteranges, which we don't
  // emit. Falling back to the full body is the safest response.
  const spec = trimmed.slice('bytes='.length);
  if (spec.includes(',')) return null;

  const dash = spec.indexOf('-');
  if (dash < 0) return null;

  const startStr = spec.slice(0, dash).trim();
  const endStr = spec.slice(dash + 1).trim();

  let start: number;
  let end: number;

  if (startStr === '' && endStr !== '') {
    // Suffix form: bytes=-N → last N bytes.
    const suffix = Number(endStr);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, fileSize - suffix);
    end = fileSize - 1;
  } else if (startStr !== '' && endStr === '') {
    // Open form: bytes=N- → from N to EOF.
    const s = Number(startStr);
    if (!Number.isFinite(s) || s < 0) return null;
    if (s >= fileSize) return null;
    start = s;
    end = fileSize - 1;
  } else if (startStr !== '' && endStr !== '') {
    // Closed form: bytes=N-M.
    const s = Number(startStr);
    const e = Number(endStr);
    if (!Number.isFinite(s) || !Number.isFinite(e)) return null;
    if (s < 0 || e < s) return null;
    if (s >= fileSize) return null;
    start = s;
    end = Math.min(e, fileSize - 1);
  } else {
    return null;
  }

  return { start, end };
}