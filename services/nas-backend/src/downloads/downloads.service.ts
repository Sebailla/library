import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DOWNLOADS_REPOSITORY,
  Download,
  DownloadStats,
  DownloadsRepository,
  NewDownload,
} from './downloads.repository';

/** Result returned by ``POST /api/downloads``. */
export interface CreateDownloadResponse {
  download_id: number;
  resume_supported: boolean;
}

/** Result returned by ``PATCH /api/downloads/:id``. */
export interface UpdateDownloadResponse {
  id: number;
  completed: boolean;
  bytes_transferred: number;
  book_id: number;
  device_id: string | null;
  downloaded_at: string;
}

/** Result returned by ``GET /api/downloads/by-device/:device_id``. */
export interface ListByDeviceResponse {
  data: Array<{
    id: number;
    book_id: number;
    device_id: string | null;
    device_name: string | null;
    user_id: string | null;
    downloaded_at: string;
    file_size_bytes: number | null;
    bytes_transferred: number | null;
    completed: boolean;
  }>;
}

/**
 * PR-N3 — Result returned by ``GET /api/downloads/by-book/:book_id``.
 *
 * Top-N devices that have downloaded the given book, ordered by
 * download count DESC and ``device_id`` ASC for ties. ``last_downloaded_at``
 * is the most recent ``downloaded_at`` for the (device, book) pair
 * — useful for the admin dashboard to spot stale vs active readers.
 */
export interface TopDevicesForBookResponse {
  book_id: number;
  top_devices: Array<{
    device_id: string;
    device_name: string | null;
    count: number;
    last_downloaded_at: string;
  }>;
}

/** Inputs to ``createDownload``. */
export interface CreateDownloadInput {
  bookId: number;
  deviceId?: string | null;
  deviceName?: string | null;
  userId?: string | null;
  fileSizeBytes?: number | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Inputs to ``updateDownload``.
 *
 * 4R review #42 — ``requestingDeviceId`` is the bearer device
 * resolved by ``JwtAuthGuard``. The service compares it against
 * ``existing.deviceId`` and refuses the update with
 * ``FORBIDDEN`` when the row belongs to another device.
 */
export interface UpdateDownloadInput {
  completed: boolean;
  bytesTransferred: number;
  requestingDeviceId: string;
}

/**
 * Downloads service — owns the business logic for the
 * ``/api/downloads`` HTTP surface.
 *
 * Idempotency rule (per ``openspec/changes/alejandria-v2/specs/
 * download-tracking/spec.md`` § "Idempotent re-attempts"): when a
 * client re-POSTs the same ``(book_id, device_id)`` and the existing
 * row is already ``completed = true``, we MUST return the same
 * ``download_id`` with ``resume_supported: true`` instead of
 * inserting a duplicate row. The original row is preserved.
 */
@Injectable()
export class DownloadsService {
  constructor(
    @Inject(DOWNLOADS_REPOSITORY)
    private readonly downloads: DownloadsRepository,
  ) {}

  /**
   * Record a new download, or hand back the original
   * ``download_id`` if the device already completed the same book.
   */
  async createDownload(
    input: CreateDownloadInput,
  ): Promise<CreateDownloadResponse> {
    if (input.deviceId) {
      const existing = await this.downloads.findCompletedForDeviceAndBook(
        input.deviceId,
        input.bookId,
      );
      if (existing) {
        return {
          download_id: existing.id,
          resume_supported: true,
        };
      }
    }
    const created = await this.downloads.insert(toNewDownload(input));
    return {
      download_id: created.id,
      resume_supported: false,
    };
  }

  /**
   * Update a download row.
   *
   * 4R review #42 — IDOR: the row's ``deviceId`` MUST match the
   * bearer's device. A mismatch raises ``FORBIDDEN`` and the
   * repository is NOT touched. ``NOT_FOUND`` is still raised
   * for a genuinely missing row so the wire shape stays
   * informative for legitimate clients.
   *
   * ``completed = true`` flips the ``completed`` flag and records
   * the byte count; ``completed = false`` only updates the byte
   * count (the row stays in progress).
   */
  async updateDownload(
    id: number,
    input: UpdateDownloadInput,
  ): Promise<UpdateDownloadResponse> {
    const existing = await this.downloads.findById(id);
    if (!existing) {
      throw new NotFoundException({
        error: { code: 'NOT_FOUND', message: 'Download not found' },
      });
    }
    if (existing.deviceId !== input.requestingDeviceId) {
      throw new ForbiddenException({
        error: {
          code: 'FORBIDDEN',
          message: 'Download belongs to a different device',
        },
      });
    }
    if (input.completed) {
      await this.downloads.markCompleted(id, input.bytesTransferred);
    } else {
      await this.downloads.updateProgress(id, input.bytesTransferred);
    }
    const after = await this.downloads.findById(id);
    if (!after) {
      // The row was just updated, so a missing ``after`` would
      // indicate a serious race (concurrent delete). Surface as
      // 404 rather than crashing the request.
      throw new NotFoundException({
        error: { code: 'NOT_FOUND', message: 'Download disappeared' },
      });
    }
    return toUpdateResponse(after);
  }

  /** Aggregated download statistics powering ``GET /api/downloads/stats``. */
  async getStats(): Promise<DownloadStats> {
    return this.downloads.stats();
  }

  /**
   * PR-N3 — top devices that downloaded a given book.
   *
   * Default limit is ``10`` so the admin endpoint stays cheap
   * even on a heavily-shared book. The full implementation lands
   * in the next commit (Fake It for now so the controller
   * compiles); until then the endpoint returns an empty list.
   */
  async topDevicesForBook(
    bookId: number,
    limit: number = 10,
  ): Promise<TopDevicesForBookResponse> {
    void bookId;
    void limit;
    return { book_id: bookId, top_devices: [] };
  }

  /** Newest-first history of every download for a given device. */
  async listByDevice(deviceId: string): Promise<ListByDeviceResponse> {
    const rows = await this.downloads.listByDevice(deviceId);
    return {
      data: rows.map((row) => ({
        id: row.id,
        book_id: row.bookId,
        device_id: row.deviceId,
        device_name: row.deviceName,
        user_id: row.userId,
        downloaded_at: row.downloadedAt.toISOString(),
        file_size_bytes: row.fileSizeBytes,
        bytes_transferred: row.bytesTransferred,
        completed: row.completed,
      })),
    };
  }
}

function toNewDownload(input: CreateDownloadInput): NewDownload {
  return {
    bookId: input.bookId,
    deviceId: input.deviceId ?? null,
    deviceName: input.deviceName ?? null,
    userId: input.userId ?? null,
    fileSizeBytes: input.fileSizeBytes ?? null,
    bytesTransferred: 0,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
  };
}

function toUpdateResponse(row: Download): UpdateDownloadResponse {
  return {
    id: row.id,
    completed: row.completed,
    bytes_transferred: row.bytesTransferred ?? 0,
    book_id: row.bookId,
    device_id: row.deviceId,
    downloaded_at: row.downloadedAt.toISOString(),
  };
}
