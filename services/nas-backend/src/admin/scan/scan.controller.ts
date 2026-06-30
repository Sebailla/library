import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiBody,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Response } from 'express';
import { randomUUID } from 'crypto';
import { IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard, JwtAuthRequest } from '../../auth/jwt-auth.guard';
import { ScanAdminGuard } from './scan-admin.guard';
import {
  ScanJob,
  ScanJobKind,
  ScanProgressEvent,
} from './scan.types';
import { ScanService } from './scan.service';
import { ScanEventBus } from './scan-event-bus';
import { ApiValidationResponse } from '../../common/openapi.decorators';

/**
 * Body shape for ``POST /api/admin/scan/incremental``.
 *
 * ``library_id`` is REQUIRED for an incremental scan — the
 * worker walks a specific library's ``root_path``. A whole-NAS
 * incremental would defeat the purpose (incremental means
 * "delta on a known root"), so the global ``POST /full`` is
 * the only endpoint that accepts an empty body.
 */
class EnqueueIncrementalBody {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  library_id!: number;
}

/**
 * Wire shape returned by the enqueue endpoints. ``job_id`` is
 * the UUID the iPad client generated OR that the server minted
 * server-side; either way the client uses it as the handle for
 * every subsequent status / cancel / events call.
 */
interface EnqueueScanResponse {
  job_id: string;
}

/**
 * Wire shape returned by ``GET /api/admin/scan/status``.
 *
 * Wrapping the array in an object (``{ jobs: [...] }``) keeps the
 * wire shape extensible: future fields like ``next_cursor`` for
 * pagination do not break the existing client.
 */
interface ListScanJobsResponse {
  jobs: ScanJobDto[];
}

interface ScanJobDto {
  id: string;
  library_id: number | null;
  kind: ScanJobKind;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  total_files: number | null;
  processed_files: number;
  cancelled: boolean;
  error: string | null;
}

function toScanJobDto(job: ScanJob): ScanJobDto {
  return {
    id: job.id,
    library_id: job.libraryId,
    kind: job.kind,
    status: job.status,
    started_at: job.startedAt ? job.startedAt.toISOString() : null,
    finished_at: job.finishedAt ? job.finishedAt.toISOString() : null,
    total_files: job.totalFiles,
    processed_files: job.processedFiles,
    cancelled: job.cancelled,
    error: job.error,
  };
}

/**
 * Scan admin HTTP module — PR-N4.
 *
 *   POST  /api/admin/scan/full           → 202 { job_id } (admin)
 *   POST  /api/admin/scan/incremental    → 202 { job_id } (admin)
 *   GET   /api/admin/scan/status         → 200 { jobs: [...] }
 *   GET   /api/admin/scan/status/:job_id → 200 { job } | 404
 *   POST  /api/admin/scan/cancel/:job_id → 200 { cancelled: bool }
 *   GET   /api/admin/scan/events/:job_id → text/event-stream
 *
 * Every route sits behind ``JwtAuthGuard`` + ``ScanAdminGuard``.
 * The service layer owns the repository / BullMQ producer
 * coordination; the controller is a thin shape-mapping adapter
 * that converts snake_case wire bodies to the service DTOs and
 * back.
 */
@ApiTags('admin')
@ApiBearerAuth('bearer')
@Controller({ path: 'api/admin/scan', version: undefined })
@UseGuards(JwtAuthGuard, ScanAdminGuard)
export class ScanController {
  constructor(
    private readonly scanService: ScanService,
    private readonly bus: ScanEventBus,
  ) {}

  @Post('full')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Enqueue a full NAS-wide scan (admin only)',
    description:
      'Scans every library on the NAS. Returns the enqueued job id; the client tracks progress via `GET /api/admin/scan/status/:job_id` and the SSE stream at `GET /api/admin/scan/events/:job_id`. Requires `is_admin = true` on the paired device.',
  })
  @ApiAcceptedResponse({
    description: 'Full scan enqueued',
    schema: {
      example: { job_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479' },
    },
  })
  @ApiUnauthorizedResponse()
  @ApiForbiddenResponse()
  async enqueueFull(): Promise<EnqueueScanResponse> {
    const job = await this.scanService.enqueueScan({
      id: randomUUID(),
      libraryId: null,
      kind: 'full',
    });
    return { job_id: job.id };
  }

  @Post('incremental')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Enqueue an incremental scan for one library (admin only)',
    description:
      'Walks a single library’s `root_path` for new / changed files. Requires `library_id >= 1`. Admin-only.',
  })
  @ApiBody({
    description: 'Incremental scan parameters',
    schema: {
      example: { library_id: 1 },
    },
  })
  @ApiAcceptedResponse({
    description: 'Incremental scan enqueued',
    schema: {
      example: { job_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479' },
    },
  })
  @ApiUnauthorizedResponse()
  @ApiForbiddenResponse()
  @ApiValidationResponse()
  async enqueueIncremental(
    @Body() body: EnqueueIncrementalBody,
  ): Promise<EnqueueScanResponse> {
    const job = await this.scanService.enqueueScan({
      id: randomUUID(),
      libraryId: body.library_id,
      kind: 'incremental',
    });
    return { job_id: job.id };
  }

  @Get('status')
  @ApiOperation({
    summary: 'List every scan job known to the server',
    description: 'Returns all jobs (queued, running, done, cancelled, failed).',
  })
  @ApiOkResponse({ description: 'List of scan jobs' })
  @ApiUnauthorizedResponse()
  @ApiForbiddenResponse()
  async list(): Promise<ListScanJobsResponse> {
    const jobs = await this.scanService.listJobs();
    return { jobs: jobs.map(toScanJobDto) };
  }

  @Get('status/:job_id')
  @ApiOperation({ summary: 'Get one scan job by id' })
  @ApiOkResponse({ description: 'Scan job detail' })
  @ApiUnauthorizedResponse()
  @ApiForbiddenResponse()
  @ApiNotFoundResponse()
  async detail(
    @Param('job_id') jobId: string,
  ): Promise<{ job: ScanJobDto }> {
    const job = await this.scanService.getJob(jobId);
    if (!job) {
      throw new NotFoundException({
        error: {
          code: 'NOT_FOUND',
          message: 'scan job not found',
        },
      });
    }
    return { job: toScanJobDto(job) };
  }

  @Post('cancel/:job_id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel a queued or running scan job',
    description:
      'Cooperative cancellation — the worker checks the flag between files. Returns 200 with `cancelled: true` if the job was running or queued, `cancelled: false` if it already finished.',
  })
  @ApiOkResponse({
    description: 'Cancellation outcome',
    schema: { example: { cancelled: true } },
  })
  @ApiUnauthorizedResponse()
  @ApiForbiddenResponse()
  @ApiNotFoundResponse()
  async cancel(
    @Param('job_id') jobId: string,
  ): Promise<{ cancelled: boolean }> {
    const cancelled = await this.scanService.cancelScan(jobId);
    return { cancelled };
  }

  /**
   * SSE stream of {@link ScanProgressEvent}s for the given job.
   *
   * The controller subscribes to the {@link ScanEventBus} for the
   * job's UUID and writes every event as a ``data:`` line on the
   * SSE stream. The connection is closed when:
   *
   *   - the client disconnects (``res.on('close')``),
   *   - the job reaches a terminal status (``done`` / ``cancelled``
   *     / ``failed``) — the bus delivers the matching event and we
   *     close the response, OR
   *   - the initial row lookup fails (404 NOT_FOUND).
   *
   * Headers are set explicitly so the SSE stream works through
   * Express's default middleware stack (the framework would
   * otherwise buffer chunked responses).
   */
  @Get('events/:job_id')
  async events(
    @Param('job_id') jobId: string,
    @Res() res: Response,
  ): Promise<void> {
    const job = await this.scanService.getJob(jobId);
    if (!job) {
      res.status(HttpStatus.NOT_FOUND).json({
        error: {
          code: 'NOT_FOUND',
          message: 'scan job not found',
        },
      });
      return;
    }
    res.status(HttpStatus.OK);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const writeEvent = (event: ScanProgressEvent): void => {
      res.write(`event: ${event.type}\n`);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    // If the job is already terminal, send the cached state once
    // and close. The bus has no replay so late subscribers would
    // otherwise see an empty stream.
    if (
      job.status === 'done' ||
      job.status === 'cancelled' ||
      job.status === 'failed'
    ) {
      const terminalType: ScanProgressEvent['type'] =
        job.status === 'done'
          ? 'done'
          : job.status === 'cancelled'
            ? 'cancelled'
            : 'failed';
      writeEvent({
        jobId: job.id,
        type: terminalType,
        processed: job.processedFiles,
        total: job.totalFiles,
        error: job.error ?? undefined,
        timestamp: new Date().toISOString(),
      });
      res.end();
      return;
    }

    const unsub = this.bus.subscribe(jobId, writeEvent);
    const onClose = (): void => {
      unsub();
      res.end();
    };
    res.on('close', onClose);
  }
}