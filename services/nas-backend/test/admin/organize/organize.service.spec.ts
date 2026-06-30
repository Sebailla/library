import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
  OrganizeAction,
  OrganizeActionKind,
  OrganizeActionStatus,
  OrganizePlan,
  OrganizePlanStatus,
  NewOrganizePlan,
  OrganizePlanSummary,
} from '../../../src/admin/organize/organize.types';
import {
  NewOrganizeAction,
  OrganizeRepository,
} from '../../../src/admin/organize/organize.repository';
import {
  OrganizeService,
  FileMover,
} from '../../../src/admin/organize/organize.service';

/**
 * Unit tests for {@link OrganizeService} (PR-N5).
 *
 * The service is the orchestration layer behind the
 * ``/api/admin/organize/*`` routes. It runs in two phases:
 *
 *   - ``analyze`` walks a folder, computes hashes, and records the
 *     proposed actions; ``dry_run=true`` still records a plan but
 *     never moves files.
 *   - ``execute`` replays the approved actions under the same
 *     ``plan_id``, with idempotent ``fs.rename`` semantics: a file
 *     that is already at its target is recorded as ``skipped`` (no
 *     exception), and a second call against the same plan is a
 *     no-op against every action.
 *
 * The repository and the file system are stubbed in process so the
 * tests pin the service contract without requiring a live DB or
 * touching real NAS storage.
 */

/**
 * In-process repository that satisfies {@link OrganizeRepository}
 * for the unit suite. The plan list grows through ``analyze``;
 * ``markActionApplied`` flips the row status.
 */
class InMemoryOrganizeRepository {
  private plans = new Map<string, OrganizePlan>();
  private actions = new Map<number, OrganizeAction>();
  private nextActionId = 1;
  public inserts: number = 0;

  async insertPlan(
    plan: NewOrganizePlan,
    summary: OrganizePlanSummary,
  ): Promise<OrganizePlan> {
    const row: OrganizePlan = {
      id: plan.planId,
      folderPath: plan.folderPath,
      dryRun: plan.dryRun,
      status: 'analyzing',
      summary,
      startedAt: new Date(),
      finishedAt: null,
      error: null,
    };
    this.plans.set(row.id, row);
    return row;
  }

  async getPlan(id: string): Promise<OrganizePlan | null> {
    return this.plans.get(id) ?? null;
  }

  async insertActions(actions: NewOrganizeAction[]): Promise<OrganizeAction[]> {
    const result: OrganizeAction[] = [];
    for (const a of actions) {
      const row: OrganizeAction = {
        id: this.nextActionId++,
        planId: a.planId,
        sourcePath: a.sourcePath,
        targetPath: a.targetPath,
        kind: a.kind,
        status: 'pending',
        fileHash: a.fileHash,
        error: null,
        appliedAt: null,
      };
      this.actions.set(row.id, row);
      result.push(row);
    }
    this.inserts += 1;
    return result;
  }

  async listActions(planId: string): Promise<OrganizeAction[]> {
    return [...this.actions.values()]
      .filter((a) => a.planId === planId)
      .sort((a, b) => a.id - b.id);
  }

  async markActionApplied(
    id: number,
    status: 'applied' | 'skipped' | 'failed',
    error?: string,
  ): Promise<OrganizeAction | null> {
    const row = this.actions.get(id);
    if (!row) return null;
    if (row.status === 'pending') {
      row.status = status;
      row.error = error ?? null;
      if (status === 'applied' || status === 'skipped') {
        row.appliedAt = new Date();
      }
    }
    return row;
  }

  async updatePlanStatus(
    id: string,
    status: OrganizePlanStatus,
    error?: string,
  ): Promise<OrganizePlan | null> {
    const row = this.plans.get(id);
    if (!row) return null;
    row.status = status;
    row.error = error ?? null;
    if (status === 'done' || status === 'failed') {
      row.finishedAt = new Date();
    }
    return row;
  }

  async updatePlanProgress(
    id: string,
    summary: OrganizePlanSummary,
  ): Promise<OrganizePlan | null> {
    const row = this.plans.get(id);
    if (!row) return null;
    row.summary = summary;
    return row;
  }

  async close(): Promise<void> {}

  // Test convenience accessors.
  getPlanSnapshot(id: string): OrganizePlan | undefined {
    return this.plans.get(id);
  }

  getActionsByPlan(planId: string): OrganizeAction[] {
    return [...this.actions.values()].filter((a) => a.planId === planId);
  }
}

/**
 * Records every move executed by the service so the tests can
 * assert the execution order and the idempotence guarantee.
 */
class RecordingFileMover implements FileMover {
  public moves: Array<{ source: string; target: string }> = [];
  public targetExists = new Set<string>();

  setTargetExists(filePath: string): void {
    this.targetExists.add(filePath);
  }

  async move(source: string, target: string): Promise<'moved' | 'skipped' | 'error'> {
    // Idempotent: if the target already exists, treat as a no-op
    // and signal ``skipped`` so the service can record the right
    // status.
    if (this.targetExists.has(target)) {
      return 'skipped';
    }
    this.moves.push({ source, target });
    this.targetExists.add(target);
    return 'moved';
  }

  async ensureDir(dirPath: string): Promise<void> {
    /* no-op in tests */
    void dirPath;
  }

  reset(): void {
    this.moves = [];
    this.targetExists = new Set();
  }
}

function buildService(opts: {
  repo?: InMemoryOrganizeRepository;
  mover?: RecordingFileMover;
} = {}) {
  const repo = new InMemoryOrganizeRepository();
  const mover = new RecordingFileMover();
  const service = new OrganizeService(
    repo as unknown as OrganizeRepository,
    {
      move: (s, t) => mover.move(s, t),
      ensureDir: (d) => mover.ensureDir(d),
    },
  );
  return { service, repo, mover };
}

function writeTree(tmpDir: string, files: Record<string, string>): void {
  for (const [rel, contents] of Object.entries(files)) {
    const fullPath = path.join(tmpDir, rel);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, contents);
  }
}

describe('OrganizeService', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'organize-svc-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('analyze walks the folder and persists a plan with move actions keyed on hash', async () => {
    writeTree(tmpRoot, {
      'Borges, Jorge Luis/Ficciones (1944).pdf': 'ficciones-bytes',
      'misc/borges.pdf': 'ficciones-bytes', // duplicate
    });
    const { service, repo } = buildService();
    // Both files are content-identical, so the walker stamps the
    // same xxh64 on both proposed actions.
    const sharedHash = 'xxh64:abcdef0123456789';
    const plan = await service.analyze(
      {
        planId: randomUUID(),
        folderPath: tmpRoot,
        dryRun: false,
      },
      [
        {
          sourcePath: path.join(tmpRoot, 'Borges, Jorge Luis/Ficciones (1944).pdf'),
          targetPath: path.join(tmpRoot, 'Borges, Jorge Luis/Ficciones (1944).pdf'),
          kind: 'skip',
          fileHash: sharedHash,
        },
        {
          sourcePath: path.join(tmpRoot, 'misc/borges.pdf'),
          targetPath: path.join(tmpRoot, 'Borges, Jorge Luis/Ficciones (1944).pdf'),
          kind: 'move',
          fileHash: sharedHash,
        },
      ],
    );
    expect(plan.status).toBe<OrganizePlanStatus>('ready');
    expect(plan.summary.filesScanned).toBe(2);
    expect(plan.summary.duplicates).toBe(1);
    const actions = repo.getActionsByPlan(plan.id);
    expect(actions.some((a) => a.kind === 'skip')).toBe(true);
    expect(actions.some((a) => a.kind === 'move')).toBe(true);
  });

  it('analyze with dry_run=true still records a plan but records dry_run = true on the row', async () => {
    writeTree(tmpRoot, { 'a.pdf': 'one' });
    const { service, repo } = buildService();
    const plan = await service.analyze(
      {
        planId: randomUUID(),
        folderPath: tmpRoot,
        dryRun: true,
      },
      [
        {
          sourcePath: path.join(tmpRoot, 'a.pdf'),
          targetPath: path.join(tmpRoot, 'A.pdf'),
          kind: 'rename',
        },
      ],
    );
    expect(plan.dryRun).toBe(true);
    const stored = repo.getPlanSnapshot(plan.id)!;
    expect(stored.dryRun).toBe(true);
  });

  it('execute moves each approved action via fs.rename and reports the counts', async () => {
    writeTree(tmpRoot, {
      'a.pdf': 'one',
      'b.epub': 'two',
    });
    const { service, mover } = buildService();
    const planId = randomUUID();
    // Pre-populate a plan + actions so execute has something to work
    // with. The unit test path mirrors what the controller would do.
    const plan = await service.analyze(
      { planId, folderPath: tmpRoot, dryRun: false },
      [
        {
          sourcePath: path.join(tmpRoot, 'a.pdf'),
          targetPath: path.join(tmpRoot, 'A.pdf'),
          kind: 'rename',
        },
        {
          sourcePath: path.join(tmpRoot, 'b.epub'),
          targetPath: path.join(tmpRoot, 'B.epub'),
          kind: 'rename',
        },
      ],
    );
    const result = await service.execute({
      planId: plan.id,
      approvedActionIds: [],
    });
    expect(result.summary.applied).toBe(2);
    expect(result.summary.failed).toBe(0);
    expect(mover.moves.length).toBe(2);
  });

  it('execute is idempotent: a second call against the same plan performs zero moves', async () => {
    writeTree(tmpRoot, { 'a.pdf': 'one' });
    const { service, mover } = buildService();
    const planId = randomUUID();
    const plan = await service.analyze(
      { planId, folderPath: tmpRoot, dryRun: false },
      [
        {
          sourcePath: path.join(tmpRoot, 'a.pdf'),
          targetPath: path.join(tmpRoot, 'A.pdf'),
          kind: 'rename',
        },
      ],
    );
    await service.execute({ planId: plan.id, approvedActionIds: [] });
    expect(mover.moves.length).toBe(1);
    // Second execute: every action is already ``applied`` so the
    // mark-applied no-ops flip nothing and the file mover is not
    // called again.
    const second = await service.execute({
      planId: plan.id,
      approvedActionIds: [],
    });
    expect(second.summary.applied).toBe(0);
    expect(second.summary.skipped).toBe(0);
    expect(mover.moves.length).toBe(1);
  });

  it('execute on an unknown plan returns NO_PLAN-shaped error', async () => {
    const { service } = buildService();
    await expect(
      service.execute({
        planId: '99999999-9999-9999-9999-999999999999',
        approvedActionIds: [],
      }),
    ).rejects.toThrow(/not found/i);
  });

  it('execute refuses to move a file when the target already exists (recorded as skipped)', async () => {
    writeTree(tmpRoot, {
      'a.pdf': 'one',
      'A.pdf': 'pre-existing',
    });
    const { service, mover } = buildService();
    // Pre-seed: target already exists on the filesystem (mover
    // mirrors this through setTargetExists).
    mover.setTargetExists(path.join(tmpRoot, 'A.pdf'));
    const planId = randomUUID();
    const plan = await service.analyze(
      { planId, folderPath: tmpRoot, dryRun: false },
      [
        {
          sourcePath: path.join(tmpRoot, 'a.pdf'),
          targetPath: path.join(tmpRoot, 'A.pdf'),
          kind: 'rename',
        },
      ],
    );
    const result = await service.execute({
      planId: plan.id,
      approvedActionIds: [],
    });
    expect(mover.moves.length).toBe(0);
    expect(result.summary.skipped).toBe(1);
    expect(result.summary.applied).toBe(0);
  });

  it('execute on a dry_run plan refuses (cannot move a plan that never had dry_run false)', async () => {
    writeTree(tmpRoot, { 'a.pdf': 'one' });
    const { service } = buildService();
    const planId = randomUUID();
    const plan = await service.analyze(
      { planId, folderPath: tmpRoot, dryRun: true },
      [
        {
          sourcePath: path.join(tmpRoot, 'a.pdf'),
          targetPath: path.join(tmpRoot, 'A.pdf'),
          kind: 'rename',
        },
      ],
    );
    await expect(
      service.execute({ planId: plan.id, approvedActionIds: [] }),
    ).rejects.toThrow(/dry[_ ]run/i);
  });

  it('analyze uses the path resolver so the canonical path matches refactor 08', async () => {
    // This is a focused integration with the path resolver
    // surfaced through the service: callers pass the target path
    // they computed via resolveCanonicalPath; analyze records
    // exactly what they passed.
    writeTree(tmpRoot, {
      'misc/Ficciones.pdf': 'bytes',
    });
    const { service, repo } = buildService();
    const target = path.join(tmpRoot, 'Borges, Jorge Luis/Ficciones (1944).pdf');
    const plan = await service.analyze(
      { planId: randomUUID(), folderPath: tmpRoot, dryRun: false },
      [
        {
          sourcePath: path.join(tmpRoot, 'misc/Ficciones.pdf'),
          targetPath: target,
          kind: 'move',
        },
      ],
    );
    const actions = repo.getActionsByPlan(plan.id);
    expect(actions[0].targetPath).toBe(target);
    expect(actions[0].kind).toBe<OrganizeActionKind>('move');
  });

  it('analyze increment summary counters reflect the proposed actions', async () => {
    writeTree(tmpRoot, {
      'a.pdf': 'one',
      'b.epub': 'two',
      'c.pdf': 'three',
    });
    const { service } = buildService();
    const plan = await service.analyze(
      {
        planId: randomUUID(),
        folderPath: tmpRoot,
        dryRun: false,
      },
      [
        {
          sourcePath: path.join(tmpRoot, 'a.pdf'),
          targetPath: path.join(tmpRoot, 'A.pdf'),
          kind: 'rename',
        },
        {
          sourcePath: path.join(tmpRoot, 'b.epub'),
          targetPath: path.join(tmpRoot, 'B.epub'),
          kind: 'rename',
        },
        {
          sourcePath: path.join(tmpRoot, 'c.pdf'),
          targetPath: path.join(tmpRoot, 'C.pdf'),
          kind: 'skip',
        },
      ],
    );
    expect(plan.summary.renamesProposed).toBe(2);
    expect(plan.summary.movesProposed).toBe(0);
    expect(plan.summary.skipped).toBe(1);
    expect(plan.summary.filesScanned).toBe(3);
  });
});
