import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Ip,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsInt, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard, JwtAuthRequest } from '../auth/jwt-auth.guard';
import {
  DEVICES_REPOSITORY,
  DevicesRepository,
} from '../auth/devices.repository';
import {
  CreateDownloadInput,
  CreateDownloadResponse,
  ListByDeviceResponse,
  TopDevicesForBookResponse,
  UpdateDownloadInput,
  UpdateDownloadResponse,
} from './downloads.service';
import { DownloadStats } from './downloads.repository';
import {
  INSTRUMENTED_DOWNLOADS_SERVICE,
  InstrumentedDownloadsService,
} from '../observability/downloads-instrumentation';

/**
 * Body shape for ``POST /api/downloads``.
 *
 * 4R review #42 — ``device_id``, ``device_name`` and ``user_id``
 * are intentionally NOT part of this DTO. The server derives
 * every identity-related field from ``req.device`` (populated by
 * ``JwtAuthGuard``) so a client cannot spoof attribution by
 * sending values in the body. ``forbidNonWhitelisted: true`` on
 * the global ValidationPipe rejects unknown fields so a leftover
 * client cannot even smuggle them through.
 */
export class CreateDownloadDto {
  @Type(() => Number)
  @IsInt()
  book_id!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  file_size_bytes?: number;
}

/** Body shape for ``PATCH /api/downloads/:id``. */
export class UpdateDownloadDto {
  @IsOptional()
  completed?: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  bytes_transferred!: number;
}

/**
 * Downloads HTTP module — PR-2E, work unit 1, extended PR-N3.
 *
 *   POST  /api/downloads                  → DownloadsService.createDownload
 *   PATCH /api/downloads/:id              → DownloadsService.updateDownload
 *   GET   /api/downloads/stats            → DownloadsService.getStats (admin)
 *   GET   /api/downloads/by-book/:book_id → top devices for a book (admin)
 *   GET   /api/downloads/by-device/:id    → DownloadsService.listByDevice
 *
 * All endpoints require a valid Bearer token (PR-2C's
 * ``JwtAuthGuard``). The service layer owns the
 * idempotency / resume logic so the controller stays a thin
 * shape-mapping adapter.
 *
 * 4R review #42 — IDOR hardening:
 *
 *   - POST derives ``deviceId`` / ``deviceName`` / ``userId``
 *     from ``req.device`` exclusively. Body fields that could
 *     be used to spoof attribution were dropped from the DTO.
 *
 *   - PATCH looks up the row first and refuses with
 *     ``403 FORBIDDEN`` when ``row.device_id`` does not match
 *     ``req.device.deviceId``. The check lives in the service
 *     because the controller is otherwise a shape-mapping
 *     adapter; the IDOR contract is a service-layer invariant.
 *
 *   - GET /by-device/:device_id compares the path param to the
 *     bearer device and refuses with ``403 FORBIDDEN`` on
 *     mismatch. ``req.device.deviceId`` is the only allowed
 *     value.
 *
 * PR-N3 — admin gate:
 *
 *   - GET /stats + GET /by-book/:book_id require
 *     ``device.is_admin = true`` (migration 015). Non-admin
 *     bearers get ``403 ADMIN_REQUIRED`` so a paired (but
 *     unprivileged) client cannot read aggregated download
 *     telemetry. The check is a request concern, so it lives
 *     next to the controller rather than the service layer.
 *
 *   - POST, PATCH, and GET /by-device/:id are OPEN to every
 *     paired device. POST and PATCH only operate on the
 *     bearer's own rows; /by-device/:id enforces path-vs-bearer
 *     ownership (4R #42).
 *
 * PR-N7 / issue #99 — observability: the controller injects the
 * ``INSTRUMENTED_DOWNLOADS_SERVICE`` token instead of
 * ``MetricsService`` directly so the metric-emitting wrapper is
 * the ONLY call site for ``recordDownload``. Inline calls from
 * the controller would double-count the started/in_progress/
 * completed transitions AND skip the ``state="failed"`` series
 * the adapter emits on throw, so the token is mandatory.
 */
@Controller({ path: 'api/downloads', version: undefined })
@UseGuards(JwtAuthGuard)
export class DownloadsController {
  constructor(
    @Inject(INSTRUMENTED_DOWNLOADS_SERVICE)
    private readonly downloadsService: InstrumentedDownloadsService,
    @Inject(DEVICES_REPOSITORY)
    private readonly devices: DevicesRepository,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() body: CreateDownloadDto,
    @Req() req: JwtAuthRequest,
    @Ip() ip: string,
  ): Promise<CreateDownloadResponse> {
    const input: CreateDownloadInput = {
      bookId: body.book_id,
      // 4R #42 — every identity field comes from req.device,
      // never from the body. ``JwtAuthGuard`` populates
      // ``req.device`` after a successful bearer-token
      // resolution.
      deviceId: req.device?.deviceId ?? null,
      deviceName: req.device?.deviceName ?? null,
      userId: null,
      fileSizeBytes: body.file_size_bytes ?? null,
      ipAddress: ip,
      userAgent: (req.headers as Record<string, string | undefined>)['user-agent'] ?? null,
    };
    // PR-N7 / issue #99 — delegating to the instrumented
    // service emits ``state="started"`` (and ``state="failed"``
    // if the service throws).
    return this.downloadsService.createDownload(input);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateDownloadDto,
    @Req() req: JwtAuthRequest,
  ): Promise<UpdateDownloadResponse> {
    const bearerDeviceId = req.device?.deviceId;
    if (!bearerDeviceId) {
      // Defensive: JwtAuthGuard should have rejected without a
      // device, but if it ever didn't we must not silently let
      // the request through.
      throw new ForbiddenException({
        error: {
          code: 'FORBIDDEN',
          message: 'No device bound to bearer token',
        },
      });
    }
    const input: UpdateDownloadInput = {
      completed: body.completed ?? false,
      bytesTransferred: body.bytes_transferred,
      requestingDeviceId: bearerDeviceId,
    };
    // PR-N7 / issue #99 — the instrumented service records
    // ``state="in_progress"`` and ``state="completed"``
    // (when the body flips the flag) BEFORE delegating, and
    // ``state="failed"`` if the service throws. The controller
    // stays shape-only.
    return this.downloadsService.updateDownload(id, input);
  }

  @Get('stats')
  async stats(@Req() req: JwtAuthRequest): Promise<DownloadStats> {
    await this.assertAdmin(req);
    return this.downloadsService.getStats();
  }

  @Get('by-book/:book_id')
  async byBook(
    @Param('book_id', ParseIntPipe) bookId: number,
    @Req() req: JwtAuthRequest,
  ): Promise<TopDevicesForBookResponse> {
    await this.assertAdmin(req);
    return this.downloadsService.topDevicesForBook(bookId);
  }

  @Get('by-device/:device_id')
  byDevice(
    @Param('device_id') deviceId: string,
    @Req() req: JwtAuthRequest,
  ): Promise<ListByDeviceResponse> {
    const bearerDeviceId = req.device?.deviceId;
    if (!bearerDeviceId || bearerDeviceId !== deviceId) {
      throw new ForbiddenException({
        error: {
          code: 'FORBIDDEN',
          message: 'Bearer device does not match path param',
        },
      });
    }
    return this.downloadsService.listByDevice(deviceId);
  }

  /**
   * PR-N3 — admin gate. Resolves the bearer's device against the
   * ``devices.is_admin`` column (migration 015). A missing
   * ``req.device`` (defensive — ``JwtAuthGuard`` should have
   * rejected without a device) AND a non-admin row both raise
   * the same ``403 ADMIN_REQUIRED`` envelope so the wire shape
   * is stable for clients.
   */
  private async assertAdmin(req: JwtAuthRequest): Promise<void> {
    const bearerDeviceId = req.device?.deviceId;
    if (!bearerDeviceId) {
      throw new ForbiddenException({
        error: {
          code: 'ADMIN_REQUIRED',
          message: 'admin role required',
        },
      });
    }
    const isAdmin = await this.devices.isAdmin(bearerDeviceId);
    if (!isAdmin) {
      throw new ForbiddenException({
        error: {
          code: 'ADMIN_REQUIRED',
          message: 'admin role required',
        },
      });
    }
  }
}
