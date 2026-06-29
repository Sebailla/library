import {
  Controller,
  Get,
  Head,
  Headers,
  Inject,
  Logger,
  NotFoundException,
  Param,
  ParseIntPipe,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FilesService, RangeParseError } from './files.service';
import { FORMAT_TO_MIME, RangeSpec } from './files.types';

/** Provider token for the library root directory (NAS_LIBRARY_ROOT). */
export const LIBRARY_ROOT = 'LIBRARY_ROOT';

/**
 * Resolve the MIME type for a stored ``books.format`` value.
 *
 * Falls back to ``application/octet-stream`` for unmapped formats
 * — the client still gets a downloadable body, just without a
 * strong type hint.
 */
function mimeFor(format: string | null | undefined): string {
  if (!format) return 'application/octet-stream';
  return FORMAT_TO_MIME[format.toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Files HTTP controller — PR-N1.
 *
 *   GET  /api/files/:book_id   → stream the book file (Range-aware)
 *   HEAD /api/files/:book_id   → metadata only
 *
 * Both routes require a valid Bearer token (the project-wide
 * ``JwtAuthGuard`` was added in PR-2C). The controller is a thin
 * shape-mapping adapter; the streaming, header composition, and
 * path validation live in {@link FilesService}.
 *
 * Errors:
 *
 *   404 FILE_NOT_FOUND       — book missing OR path escapes
 *                              the library root (path-traversal
 *                              hardening; intentionally vague so
 *                              the configured library root is not
 *                              leaked)
 *   416 RANGE_NOT_SATISFIABLE — Range header present but cannot
 *                              be satisfied (start >= fileSize)
 *   500 FILE_READ_ERROR      — underlying fs.createReadStream
 *                              failed mid-flight
 */
@Controller({ path: 'api/files', version: undefined })
@UseGuards(JwtAuthGuard)
export class FilesController {
  private readonly logger = new Logger(FilesController.name);

  constructor(private readonly files: FilesService) {}

  @Get(':book_id')
  async download(
    @Param('book_id', ParseIntPipe) bookId: number,
    @Headers('range') rangeHeader: string | undefined,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.serve(bookId, rangeHeader, ifNoneMatch, req, res);
  }

  @Head(':book_id')
  async head(
    @Param('book_id', ParseIntPipe) bookId: number,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    // HEAD shares every header with GET (including Content-Length
    // for the FULL file, per RFC 9110 §15.3.2) but the body is
    // suppressed by Express automatically when the route matches
    // @Head().
    await this.serve(bookId, undefined, undefined, req, res);
  }

  /**
   * Shared body for GET and HEAD: parse Range, resolve the path,
   * delegate to {@link FilesService.streamFile}.
   *
   * The Range parse happens here (not in the service) so we can
   * translate the parser's ``null`` vs. throw contract into a
   * clean 200/206/416 dispatch.
   */
  private async serve(
    bookId: number,
    rangeHeader: string | undefined,
    ifNoneMatch: string | undefined,
    _req: Request,
    res: Response,
  ): Promise<void> {
    const filePath = await this.files.resolveBookFilePath(bookId);

    // We need the file size to validate a Range request before
    // stat'ing again in streamFile. Doing it here lets us emit a
    // 416 cleanly without opening a stream handle.
    const fs = await import('fs/promises');
    const stat = await fs.stat(filePath);
    const fileSize = stat.size;

    let range: RangeSpec | null = null;
    if (rangeHeader !== undefined) {
      try {
        range = this.files.parseRangeHeader(rangeHeader, fileSize);
      } catch (err) {
        if (err instanceof RangeParseError) {
          res.status(416);
          res.setHeader('Content-Range', `bytes */${fileSize}`);
          res.end();
          return;
        }
        throw err;
      }
      if (rangeHeader.trim().length > 0 && range === null) {
        // Header was present and syntactically looks like a Range
        // request (e.g. ``bytes=99999999-``) but could not be
        // satisfied — per RFC 9110 §15.5.17 we MUST emit 416 with
        // a Content-Range that reflects the actual size.
        res.status(416);
        res.setHeader('Content-Range', `bytes */${fileSize}`);
        res.end();
        return;
      }
    }

    const book = await this.files['books'].findById(bookId);
    const contentType = mimeFor(book?.format);

    try {
      await this.files.streamFile(filePath, range, res, {
        contentType,
        ifNoneMatch,
      });
    } catch (err) {
      // streamFile handles the headers-not-sent case internally;
      // a throw here means something else blew up — log + 500.
      this.logger.error(
        `Unexpected error streaming file for book ${bookId}: ${(err as Error).message}`,
      );
      if (!res.headersSent) {
        res.status(500).json({
          error: {
            code: 'FILE_READ_ERROR',
            message: (err as Error).message,
          },
        });
      }
    }
  }
}

// Silence unused-import warnings in some toolchains.
void NotFoundException;
void Inject;