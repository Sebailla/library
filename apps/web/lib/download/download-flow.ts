import { writeFile as fsWriteFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { mkdir } from 'node:fs/promises'

import {
  type INasClient,
  type NasBookDetail,
  type NasStartDownloadResponse,
  type NasCompleteDownloadResponse,
} from '../api/nas-client'
import { openLocalDb, type BookInput } from '../db/local-db'
import { withRetry } from './retry'

/**
 * High-level "download a book" orchestration (PR-3C).
 *
 * Composes:
 *  1. `INasClient.getBook` — resolve the book metadata.
 *  2. `INasClient.startDownload` — open a tracking row on the NAS
 *     so the user's "My downloads" panel can show progress.
 *  3. `INasClient.downloadFile` — stream the bytes to `destPath`
 *     via the Range request the client is configured for.
 *  4. `openLocalDb().insertBook` — make the book readable by the
 *     offline-first reader.
 *  5. `INasClient.completeDownload` — close the tracking row.
 *
 * On any failure between `startDownload` and the byte transfer
 * the function propagates the error WITHOUT calling
 * `completeDownload` (so the NAS can later reconcile the dangling
 * row via the periodic scan worker).
 *
 * The flow is dependency-injected — every test seam is a named
 * option, and the local DB is opened via the standard
 * `ALEJANDRIA_DATA_DIR` env var.
 */

export interface DownloadBookOptions {
  bookId: number
  deviceId: string
  deviceName: string
  userId: string
  /** Absolute path to the destination file. */
  destPath: string
  /** NAS client (or test double) used for every HTTP call. */
  nasClient: INasClient
  /** Writer used to persist the bytes (defaults to `fs/promises.writeFile`). */
  writeFile?: (path: string, data: Uint8Array) => Promise<void>
  /** Optional progress callback. */
  onProgress?: (bytesReceived: number) => void
  /** Override the local DB opener (used by tests). */
  openDb?: typeof openLocalDb
  /** Open the DB but do not close it (defaults to `false`). */
  leaveDbOpen?: boolean
  /**
   * Bytes already on disk at `destPath` (used for resume). When
   * non-zero the flow starts the byte transfer with
   * `Range: bytes=<start>-` so the NAS only sends the tail.
   * PR-3-fix-B #62.
   */
  start?: number
  /**
   * Override the retry helper (used by tests that want fast
   * retries / no real timers). Defaults to `withRetry` with
   * `attempts=3, backoff='exp', baseMs=250`.
   */
  retry?: <T>(fn: () => Promise<T>) => Promise<T>
}

export interface DownloadBookResult {
  book: NasBookDetail
  downloadId: number
  filePath: string
  bytesTransferred: number
  tracking: NasCompleteDownloadResponse
  trackingStart: NasStartDownloadResponse
}

const defaultWriteFile: (path: string, data: Uint8Array) => Promise<void> = async (
  path,
  data,
) => {
  await fsWriteFile(path, data)
}

/**
 * Download a book from the NAS, persist it locally, and close
 * the tracking row on the NAS.
 *
 * PR-3-fix-B #62: each NAS round-trip step is wrapped in
 * `withRetry` (attempts=3, exp backoff, 250 ms base) so a single
 * 503 / 504 / network drop doesn't leave a tracking row open on
 * the NAS. Resume support is wired via the `start` option:
 * pre-existing bytes on disk are passed to `downloadFile({ start })`
 * which appends them to the Range request.
 */
export async function downloadBook(options: DownloadBookOptions): Promise<DownloadBookResult> {
  const {
    bookId,
    deviceId,
    deviceName,
    userId,
    destPath,
    nasClient,
    onProgress,
    start = 0,
  } = options
  const writeFile = options.writeFile ?? defaultWriteFile
  const openDb = options.openDb ?? openLocalDb
  // Default retry: 3 attempts with exponential backoff (250 ms,
  // 500 ms). Tests inject a no-op retry for speed.
  const retry = options.retry ?? ((fn) => withRetry(fn))

  // 1. Resolve the metadata we will store locally. PR-3-fix-B
  //    #62: each NAS round-trip is wrapped in `withRetry`.
  const book = await retry(() => nasClient.getBook(bookId))

  // 2. Open the NAS tracking row BEFORE we start writing bytes so
  //    the user's "My downloads" panel can render the file as
  //    "in progress" immediately.
  const trackingStart = await retry(() =>
    nasClient.startDownload({
      bookId,
      deviceId,
      deviceName,
      userId,
      fileSizeBytes: book.file_size_bytes ?? 0,
    }),
  )

  // 3. Stream the bytes. If anything throws here, the NAS tracking
  //    row stays open — the periodic scan worker reconciles it.
  //
  //    `bytesReceived` is captured from the FINAL `onProgress`
  //    callback, which `nas-client.downloadFile` fires with the
  //    cumulative byte count after each chunk. That value is the
  //    ACTUAL number of bytes persisted to disk — not the
  //    pre-flight expected size from `book.file_size_bytes`,
  //    which can diverge on partial / failed / resumed transfers.
  //
  //    PR-3-fix-B #62: the flow also wires resume support via
  //    `start`. When `start > 0` the caller asserts those bytes
  //    are already on disk and `downloadFile` only fetches the
  //    tail with `Range: bytes=<start>-`.
  await mkdir(dirname(destPath), { recursive: true })
  let lastProgressValue = 0
  await retry(() =>
    nasClient.downloadFile(
      bookId,
      destPath,
      (bytes) => {
        lastProgressValue = bytes
        if (onProgress) onProgress(bytes)
      },
      { writeFile, start },
    ),
  )
  // The cumulative byte count includes the resume offset (the
  // caller passed `start = bytes already on disk`). Report that
  // full count to `completeDownload` so the NAS's "bytes
  // transferred" ledger stays accurate across resumed transfers.
  const bytesReceived = start + lastProgressValue

  // 4. Insert the local row so the Reader can find the book.
  const db = openDb()
  const localRow = persistBookRow(db, book, destPath)
  if (!options.leaveDbOpen) {
    db.close()
  }

  // 5. Close the tracking row with the ACTUAL byte count. If the
  //    transfer produced zero bytes (e.g. an empty 200 response
  //    or a write that threw after partial progress), report 0
  //    rather than the pre-flight expected size.
  const tracking = await retry(() =>
    nasClient.completeDownload(trackingStart.download_id, {
      completed: true,
      bytesTransferred: bytesReceived,
    }),
  )

  return {
    book,
    downloadId: trackingStart.download_id,
    filePath: localRow.filePath,
    bytesTransferred: bytesReceived,
    tracking,
    trackingStart,
  }
}

function persistBookRow(
  db: ReturnType<typeof openLocalDb>,
  book: NasBookDetail,
  destPath: string,
): { id: string; filePath: string } {
  // `author_id` is the only author surface the NAS exposes on
  // the detail payload. The local SQLite's `books.author` is a
  // TEXT column; we materialise a placeholder so the row is
  // well-formed. A follow-up PR joins `/api/authors/:id` for the
  // display name and re-upserts the row.
  const authorLabel = book.author_id !== null ? `author:${book.author_id}` : 'unknown'
  const id = String(book.id)
  const input: BookInput = {
    id,
    title: book.title,
    author: authorLabel,
    year: book.year ?? 0,
    format: book.format ?? 'pdf',
    filePath: join(destPath),
    contentHash: book.content_hash ?? `nas:${id}`,
    excerpt: book.excerpt ?? '',
  }
  db.insertBook(input)
  return { id, filePath: input.filePath }
}
