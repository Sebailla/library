import { Controller, Get, Inject, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, JwtAuthRequest } from '../auth/jwt-auth.guard';
import {
  DOWNLOADS_REPOSITORY,
  DownloadsRepository,
} from '../downloads/downloads.repository';

/**
 * ``/api/me`` namespace — caller-scoped read endpoints.
 *
 *   GET /api/me             → 200 {device_id, device_name}
 *   GET /api/me/downloads   → 200 {data: Download[]} (PR-N3)
 *
 * Both routes are behind ``JwtAuthGuard``. The downloads endpoint
 * filters server-side by ``req.device.deviceId`` so the client
 * cannot ask for another device's history; the privacy boundary
 * lives at the repository layer (``listForDevice``) — there is
 * no client-controlled identifier on the wire.
 *
 * Lives under ``me/`` (not ``auth/``) so future profile endpoints
 * (``PATCH /api/me``, ``GET /api/me/preferences``) can be added
 * without polluting the auth module.
 */
@Controller({ path: 'api/me', version: undefined })
@UseGuards(JwtAuthGuard)
export class MeController {
  constructor(
    @Inject(DOWNLOADS_REPOSITORY)
    private readonly downloads: DownloadsRepository,
  ) {}

  @Get()
  me(@Req() req: JwtAuthRequest): {
    device_id: string;
    device_name: string | null;
  } {
    const device = req.device;
    return {
      device_id: device?.deviceId ?? '',
      device_name: device?.deviceName ?? null,
    };
  }

  /**
   * PR-N3 — caller-scoped download history.
   *
   * The bearer's own downloads, newest first, returned in the
   * same envelope as ``/api/downloads/by-device/:id`` so a
   * client that already renders one can render the other
   * without a shape adapter. No admin check: any paired device
   * can call this — the privacy boundary is that the server
   * resolves the ``device_id`` from ``req.device`` exclusively.
   */
  @Get('downloads')
  async myDownloads(
    @Req() req: JwtAuthRequest,
  ): Promise<{
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
  }> {
    const bearerDeviceId = req.device?.deviceId;
    if (!bearerDeviceId) {
      // Defensive — ``JwtAuthGuard`` should have rejected without
      // a device. Returning an empty list rather than 500 keeps
      // the surface stable for clients.
      return { data: [] };
    }
    const rows = await this.downloads.listForDevice(bearerDeviceId);
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
