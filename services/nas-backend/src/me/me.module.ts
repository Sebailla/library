import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DownloadsModule } from '../downloads/downloads.module';
import { MeController } from './me.controller';

/**
 * ``/api/me`` namespace — caller-scoped read endpoints.
 *
 *   - ``GET /api/me``             — sample profile echo (PR-2C).
 *   - ``GET /api/me/downloads``   — caller-scoped download
 *                                   history, filtered server-side
 *                                   by ``req.device.deviceId``
 *                                   (PR-N3).
 *
 * The module imports ``AuthModule`` (for the ``JwtAuthGuard``)
 * AND ``DownloadsModule`` (for the re-exported
 * ``DOWNLOADS_REPOSITORY`` string token — the ``MeController``
 * injects it directly to call ``listForDevice`` without going
 * through ``DownloadsService``, which is reserved for the
 * HTTP-surface owned by ``DownloadsController``).
 */
@Module({
  imports: [AuthModule, DownloadsModule],
  controllers: [MeController],
})
export class MeModule {}
