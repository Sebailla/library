import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { IsArray, IsBoolean, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import {
  OrganizeAction,
  OrganizePlan,
  OrganizeActionKind,
} from './organize.types';
import {
  OrganizeService,
  ProposedAction,
  FileMover,
} from './organize.service';
import { ScanAdminGuard } from '../scan/scan-admin.guard';

/**
 * Body shape for ``POST /api/admin/organize/analyze``. The
 * ``folder_path`` MUST be an absolute path - the analyze walk
 * rejects relative paths so a typo in the iPad client cannot
 * create a plan under the cwd. ``proposed_actions`` is the
 * walker-supplied proposal (the analyze endpoint forwards the
 * controller-provided list to the service so the walker output
 * does not need its own DTO round-trip).
 *
 * ``dry_run`` is optional; the default is ``false``.
 */
class ProposedActionBody {
  @IsString()
  source_path!: string;

  @IsString()
  target_path!: string;

  @IsString()
  kind!: OrganizeActionKind;

  @IsOptional()
  @IsString()
  file_hash?: string | null;
}

class AnalyzeBody {
  @IsString()
  folder_path!: string;

  @IsOptional()
  @IsBoolean()
  dry_run?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProposedActionBody)
  proposed_actions!: ProposedActionBody[];
}

class ExecuteBody {
  @IsUUID()
  plan_id!: string;

  @IsArray()
  @IsOptional()
  approved_action_ids?: number[];
}

/**
 * Wire shape returned by ``POST /api/admin/organize/analyze``.
 * ``sample_actions`` is the first N action ids so the iPad
 * preview can render a short list without enumerating every
 * pending row.
 */
interface AnalyzeResponse {
  plan_id: string;
  summary: OrganizePlanSummaryResponse;
  sample_actions: Array<{ id: number; source_path: string; target_path: string; kind: OrganizeActionKind }>;
}

interface OrganizePlanSummaryResponse {
  files_scanned: number;
  duplicates: number;
  moves_proposed: number;
  renames_proposed: number;
  skipped: number;
}

interface PlanDetailResponse {
  plan: PlanDto;
  actions: ActionDto[];
}

interface PlanDto {
  id: string;
  folder_path: string;
  dry_run: boolean;
  status: string;
  summary: OrganizePlanSummaryResponse;
  started_at: string;
  finished_at: string | null;
  error: string | null;
}

interface ActionDto {
  id: number;
  source_path: string;
  target_path: string;
  kind: OrganizeActionKind;
  status: string;
  file_hash: string | null;
  error: string | null;
  applied_at: string | null;
}

function toPlanDto(plan: OrganizePlan): PlanDto {
  return {
    id: plan.id,
    folder_path: plan.folderPath,
    dry_run: plan.dryRun,
    status: plan.status,
    summary: {
      files_scanned: plan.summary.filesScanned,
      duplicates: plan.summary.duplicates,
      moves_proposed: plan.summary.movesProposed,
      renames_proposed: plan.summary.renamesProposed,
      skipped: plan.summary.skipped,
    },
    started_at: plan.startedAt.toISOString(),
    finished_at: plan.finishedAt ? plan.finishedAt.toISOString() : null,
    error: plan.error,
  };
}

function toActionDto(action: OrganizeAction): ActionDto {
  return {
    id: action.id,
    source_path: action.sourcePath,
    target_path: action.targetPath,
    kind: action.kind,
    status: action.status,
    file_hash: action.fileHash,
    error: action.error,
    applied_at: action.appliedAt ? action.appliedAt.toISOString() : null,
  };
}

/**
 * Admin organize HTTP module — PR-N5.
 *
 *   POST  /api/admin/organize/analyze   → 201 { plan_id, summary, sample_actions[] }
 *   POST  /api/admin/organize/execute   → 200 { plan_id, summary }
 *   GET   /api/admin/organize/plans/:plan_id → 200 { plan, actions[] } | 404
 *
 * Every route sits behind ``JwtAuthGuard`` + ``ScanAdminGuard``,
 * reusing the same admin gate as PR-N4 (admin paired device).
 */
@Controller({ path: 'api/admin/organize', version: undefined })
@UseGuards(JwtAuthGuard, ScanAdminGuard)
export class OrganizeController {
  constructor(
    private readonly organizeService: OrganizeService,
  ) {}

  @Post('analyze')
  @HttpCode(HttpStatus.CREATED)
  async analyze(
    @Body() body: AnalyzeBody,
  ): Promise<AnalyzeResponse> {
    const planId = randomUUID();
    const proposed: ProposedAction[] = body.proposed_actions.map((a) => ({
      sourcePath: a.source_path,
      targetPath: a.target_path,
      kind: a.kind,
      fileHash: a.file_hash ?? null,
    }));
    const plan = await this.organizeService.analyze(
      {
        planId,
        folderPath: body.folder_path,
        dryRun: body.dry_run ?? false,
      },
      proposed,
    );
    const actions = await this.organizeService.listActions(plan.id);
    return {
      plan_id: plan.id,
      summary: {
        files_scanned: plan.summary.filesScanned,
        duplicates: plan.summary.duplicates,
        moves_proposed: plan.summary.movesProposed,
        renames_proposed: plan.summary.renamesProposed,
        skipped: plan.summary.skipped,
      },
      sample_actions: actions.slice(0, 5).map((a) => ({
        id: a.id,
        source_path: a.sourcePath,
        target_path: a.targetPath,
        kind: a.kind,
      })),
    };
  }

  @Post('execute')
  @HttpCode(HttpStatus.OK)
  async execute(@Body() body: ExecuteBody): Promise<{
    plan_id: string;
    summary: {
      applied: number;
      skipped: number;
      failed: number;
      failed_action_ids: number[];
    };
  }> {
    try {
      const result = await this.organizeService.execute({
        planId: body.plan_id,
        approvedActionIds: body.approved_action_ids ?? [],
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'execute failed';
      if (/not found/i.test(message)) {
        throw new BadRequestException({
          error: { code: 'NO_PLAN', message },
        });
      }
      if (/dry[_ ]run/i.test(message)) {
        throw new BadRequestException({
          error: { code: 'DRY_RUN_LOCKED', message },
        });
      }
      throw err;
    }
  }

  @Get('plans/:plan_id')
  async detail(@Param('plan_id') planId: string): Promise<PlanDetailResponse> {
    const plan = await this.organizeService.getPlan(planId);
    if (!plan) {
      throw new NotFoundException({
        error: {
          code: 'NOT_FOUND',
          message: 'organize plan not found',
        },
      });
    }
    const actions = await this.organizeService.listActions(plan.id);
    return {
      plan: toPlanDto(plan),
      actions: actions.map(toActionDto),
    };
  }
}

/**
 * Concrete {@link FileMover} backed by ``fs.rename`` /
 * ``fs.mkdir``. The factory lets the module inject the production
 * mover while the controller test stub substitutes an in-memory
 * implementation.
 */
export class FsFileMover implements FileMover {
  async move(source: string, target: string): Promise<'moved' | 'skipped' | 'error'> {
    const fs = await import('fs/promises');
    try {
      // ``fs.rename`` is atomic on the same filesystem and is the
      // primitive the spec mandates. The action is skipped (NOT
      // failed) when the target already exists so execute is
      // idempotent.
      try {
        await fs.access(target);
        return 'skipped';
      } catch {
        /* target does not exist - fall through to rename */
      }
      await fs.rename(source, target);
      return 'moved';
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // EEXIST signal: another concurrent execute already moved.
      // Treat as skip so the row records ``skipped`` instead of
      // ``failed`` for a race we already won.
      if (/EEXIST|EACCES/.test(message)) {
        return 'skipped';
      }
      return 'error';
    }
  }

  async ensureDir(dirPath: string): Promise<void> {
    const fs = await import('fs/promises');
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (err) {
      // If the directory already exists the recursive mkdir is
      // a no-op; a real EACCES propagates so the execute path
      // can mark the action failed.
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') throw err;
    }
  }
}
