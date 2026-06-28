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
  } = options
  const writeFile = options.writeFile ?? defaultWriteFile
  const openDb = options.openDb ?? openLocalDb

  // 1. Resolve the metadata we will store locally.
  const book = await nasClient.getBook(bookId)

  // 2. Open the NAS tracking row BEFORE we start writing bytes so
  //    the user's "My downloads" panel can render the file as
  //    "in progress" immediately.
  const trackingStart = await nasClient.startDownload({
    bookId,
    deviceId,
    deviceName,
    userId,
    fileSizeBytes: book.file_size_bytes ?? 0,
  })

  // 3. Stream the bytes. If anything throws here, the NAS tracking
  //    row stays open — the periodic scan worker reconciles it.
  await mkdir(dirname(destPath), { recursive: true })
  await nasClient.downloadFile(bookId, destPath, (bytes) => {
    if (onProgress) onProgress(bytes)
  }, { writeFile })

  // 4. Insert the local row so the Reader can find the book.
  const db = openDb()
  const localRow = persistBookRow(db, book, destPath)
  if (!options.leaveDbOpen) {
    db.close()
  }

  // 5. Close the tracking row.
  const tracking = await nasClient.completeDownload(trackingStart.download_id, {
    completed: true,
    bytesTransferred: book.file_size_bytes ?? 0,
  })

  return {
    book,
    downloadId: trackingStart.download_id,
    filePath: localRow.filePath,
    bytesTransferred: tracking.bytes_transferred,
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
