import { Inject, Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import {
  NewOrganizeAction,
  OrganizeRepository,
  ORGANIZE_REPOSITORY,
} from './organize.repository';
import {
  OrganizeAction,
  OrganizePlan,
  OrganizePlanSummary,
  OrganizeExecuteSummary,
  NewOrganizePlan,
  OrganizeActionKind,
} from './organize.types';
import { ExecuteResponse } from './organize.contract';

/**
 * Filesystem-touching surface the service needs. Decoupled from
 * the concrete ``fs`` module so the unit suite can substitute an
 * in-memory implementation while the production code uses real
 * ``fs.rename`` + ``fs.mkdir``.
 *
 * The service treats the mover as the platform boundary - the
 * analyze step (read-only file walks) uses ``fs.promises.readdir``
 * directly via the walker adapter, while the execute step delegates
 * every actual file move to this interface.
 */
export interface FileMover {
  /**
   * Move ``source`` to ``target``. Must be idempotent: when the
   * target already exists, the implementation resolves with
   * ``'skipped'`` so the service records the action as skipped
   * (NOT as failed). Errors at the fs level resolve as
   * ``'error'`` so the service can mark the action failed with
   * the captured message.
   */
  move(
    source: string,
    target: string,
  ): Promise<'moved' | 'skipped' | 'error'>;
  /**
   * Ensure the target's parent directory exists before the move
   * runs. Used to lazily create the author folder layout.
   */
  ensureDir(dirPath: string): Promise<void>;
}

/**
 * String token used to inject the {@link FileMover} into the
 * service.
 */
export const FILE_MOVER = 'FILE_MOVER';

/**
 * Source action the analyze layer produces. Pure data - the
 * walker (the read-only fs half) computes these from the folder
 * walk, the service persists them and owns the lifecycle.
 */
export interface ProposedAction {
  sourcePath: string;
  targetPath: string;
  kind: OrganizeActionKind;
  fileHash?: string | null;
}

/**
 * Result the analyze step returns to the controller. The plan id
 * is caller-supplied so a future PR can switch to server-side
 * id minting without a contract change.
 */
export interface AnalyzeResult {
  plan: OrganizePlan;
  actions: OrganizeAction[];
}

export interface ExecuteInput {
  planId: string;
  approvedActionIds: number[];
}

/**
 * Analytics + lifecycle surface for the admin organize routes
 * (PR-N5).
 *
 * Two methods; both are pure orchestration:
 *
 *   - ``analyze`` records the plan row + a batch of proposed
 *     actions under that plan, then transitions the plan to
 *     ``ready``.
 *   - ``execute`` replays the actions under the same plan,
 *     idempotent against re-runs (the
 *     ``markActionApplied`` repository primitive refuses to
 *     rewrite ``applied`` rows).
 *
 * The filesystem surface is delegated to {@link FileMover} so
 * the test suite can stub the real fs layer and the controller
 * remains a thin shape-mapping adapter.
 */
@Injectable()
export class OrganizeService {
  private readonly logger = new Logger(OrganizeService.name);

  constructor(
    @Inject(ORGANIZE_REPOSITORY)
    private readonly repo: OrganizeRepository,
    @Inject(FILE_MOVER)
    private readonly mover: FileMover,
  ) {}

  /**
   * Persist the analyze request as a plan with the caller-supplied
   * proposed actions. The caller (the controller) is responsible
   * for the actual folder walk because the production walker
   * delegates to the Python sidecar and is async by design; the
   * service keeps the boundary narrow - it owns persistence.
   */
  async analyze(
    input: NewOrganizePlan,
    proposed: ProposedAction[],
  ): Promise<OrganizePlan> {
    const summary = this.summarise(proposed);
    const plan = await this.repo.insertPlan(
      {
        planId: input.planId,
        folderPath: input.folderPath,
        dryRun: input.dryRun,
      },
      summary,
    );
    const actionRows: NewOrganizeAction[] = proposed.map((a) => ({
      planId: plan.id,
      sourcePath: a.sourcePath,
      targetPath: a.targetPath,
      kind: a.kind,
      fileHash: a.fileHash ?? null,
    }));
    await this.repo.insertActions(actionRows);
    const transitioned = await this.repo.updatePlanStatus(plan.id, 'ready');
    this.logger.log(
      `analyze plan ${plan.id}: ${summary.filesScanned} files ` +
        `(${summary.movesProposed} moves, ${summary.renamesProposed} renames, ` +
        `${summary.skipped} skipped)`,
    );
    return transitioned ?? plan;
  }

  /**
   * Replay the actions attached to ``planId``. Idempotent:
   * actions already in a terminal state are skipped, so
   * re-running execute is a no-op against the rows AND a no-op
   * against the filesystem (the mover itself short-circuits
   * when the target already exists).
   */
  async execute(input: ExecuteInput): Promise<ExecuteResponse> {
    const plan = await this.repo.getPlan(input.planId);
    if (!plan) {
      throw new Error(`organize plan ${input.planId} not found`);
    }
    if (plan.dryRun) {
      throw new Error(
        `organize plan ${input.planId} was created with dry_run=true; execute refuses to mutate the filesystem`,
      );
    }

    const all = await this.repo.listActions(input.planId);
    const eligible = this.filterEligible(all, input.approvedActionIds);

    await this.repo.updatePlanStatus(input.planId, 'executing');

    const summary: OrganizeExecuteSummary = {
      applied: 0,
      skipped: 0,
      failed: 0,
      failedActionIds: [],
    };

    for (const action of eligible) {
      try {
        await this.mover.ensureDir(path.dirname(action.targetPath));
        const result = await this.mover.move(action.sourcePath, action.targetPath);
        if (result === 'moved') {
          await this.repo.markActionApplied(action.id, 'applied');
          summary.applied += 1;
        } else if (result === 'skipped') {
          await this.repo.markActionApplied(action.id, 'skipped');
          summary.skipped += 1;
        } else {
          await this.repo.markActionApplied(action.id, 'failed', 'mover error');
          summary.failed += 1;
          summary.failedActionIds.push(action.id);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await this.repo.markActionApplied(action.id, 'failed', message);
        summary.failed += 1;
        summary.failedActionIds.push(action.id);
      }
    }

    await this.repo.updatePlanStatus(input.planId, 'done');
    return {
      plan_id: input.planId,
      summary: {
        applied: summary.applied,
        skipped: summary.skipped,
        failed: summary.failed,
        failed_action_ids: summary.failedActionIds,
      },
    };
  }

  /**
   * Reduce the action list to the ids the caller approved. An
   * empty / undefined list means "execute everything in the plan"
   * - the controller passes nothing in the common case where the
   * operator previews the proposed plan and clicks "execute all".
   */
  private filterEligible(
    actions: OrganizeAction[],
    approved: number[] | undefined,
  ): OrganizeAction[] {
    const eligible = actions.filter((a) => a.status === 'pending');
    if (!approved || approved.length === 0) return eligible;
    const approvedSet = new Set(approved);
    return eligible.filter((a) => approvedSet.has(a.id));
  }

  /**
   * Build the per-plan summary the analyze response ships back.
   * Duplicates are counted by fileHash collision (the walker
   * stamps every proposed action's ``fileHash`` field; two
   * distinct paths sharing a hash count as one duplicate).
   */
  private summarise(proposed: ProposedAction[]): OrganizePlanSummary {
    let movesProposed = 0;
    let renamesProposed = 0;
    let skipped = 0;
    const hashes = new Set<string>();
    let duplicates = 0;
    for (const a of proposed) {
      if (a.kind === 'move') movesProposed += 1;
      else if (a.kind === 'rename') renamesProposed += 1;
      else if (a.kind === 'skip') skipped += 1;
      if (a.fileHash) {
        if (hashes.has(a.fileHash)) {
          duplicates += 1;
        } else {
          hashes.add(a.fileHash);
        }
      }
    }
    return {
      filesScanned: proposed.length,
      duplicates,
      movesProposed,
      renamesProposed,
      skipped,
    };
  }
}
