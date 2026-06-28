import {
  Body,
  Controller,
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
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
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

/** Body shape for ``POST /api/downloads``. */
export class CreateDownloadDto {
  @Type(() => Number)
  @IsInt()
  book_id!: number;

  @IsOptional()
  @IsString()
  device_id?: string;

  @IsOptional()
  @IsString()
  device_name?: string;

  @IsOptional()
  @IsString()
  user_id?: string;

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
      deviceId: body.device_id ?? req.device?.deviceId ?? null,
      deviceName: body.device_name ?? req.device?.deviceName ?? null,
      userId: body.user_id ?? null,
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
  ): Promise<UpdateDownloadResponse> {
    const input: UpdateDownloadInput = {
      completed: body.completed ?? false,
      bytesTransferred: body.bytes_transferred,
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
  ): Promise<ListByDeviceResponse> {
    return this.downloadsService.listByDevice(deviceId);
  }
}
