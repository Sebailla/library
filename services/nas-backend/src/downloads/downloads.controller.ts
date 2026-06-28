import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
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
  CreateDownloadInput,
  CreateDownloadResponse,
  DownloadsService,
  ListByDeviceResponse,
  UpdateDownloadInput,
  UpdateDownloadResponse,
} from './downloads.service';
import { DownloadStats } from './downloads.repository';

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
 * Downloads HTTP module — PR-2E, work unit 1.
 *
 *   POST  /api/downloads                → DownloadsService.createDownload
 *   PATCH /api/downloads/:id            → DownloadsService.updateDownload
 *   GET   /api/downloads/stats          → DownloadsService.getStats
 *   GET   /api/downloads/by-device/:id  → DownloadsService.listByDevice
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
 */
@Controller({ path: 'api/downloads', version: undefined })
@UseGuards(JwtAuthGuard)
export class DownloadsController {
  constructor(private readonly downloadsService: DownloadsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
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
    return this.downloadsService.createDownload(input);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  update(
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
    return this.downloadsService.updateDownload(id, input);
  }

  @Get('stats')
  stats(): Promise<DownloadStats> {
    return this.downloadsService.getStats();
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
}
