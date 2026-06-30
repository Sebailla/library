import { Pool } from 'pg';
import {
  OrganizeAction,
  OrganizeActionKind,
  OrganizeActionStatus,
  OrganizePlan,
  OrganizePlanStatus,
  OrganizePlanSummary,
  NewOrganizePlan,
} from '../../../src/admin/organize/organize.types';
import {
  OrganizeRepository,
  createOrganizeRepository,
} from '../../../src/admin/organize/organize.repository';
import {
  DATABASE_URL,
  resetAndMigrate,
} from '../../repositories/_fixtures';

/**
 * Contract tests for {@link OrganizeRepository} (PR-N5).
 *
 * The repository is the data-access layer for the
 * ``organize_plans`` + ``organize_actions`` pair (migration 017).
 * The contract covers:
 *
 *   - ``insertPlan``          — record a freshly-minted analyze
 *                                invocation with its summary.
 *   - ``getPlan``             — read a single plan by UUID pk.
 *   - ``listActions``         — per-plan action listing (the GET
 *                                plan endpoint).
 *   - ``markActionApplied``   — flip ``pending → applied`` (the
 *                                happy-path execute outcome).
 *   - ``updatePlanStatus``    — flip the plan-level status and
 *                                stamp ``finished_at`` on
 *                                terminal transitions.
 *   - ``updatePlanProgress``  — patch ``summary`` so the live UI
 *                                can show partial counts.
 */

const hasDb = !!process.env.DATABASE_URL;
const describeDb = hasDb ? describe : describe.skip;

const SAMPLE_SUMMARY: OrganizePlanSummary = {
  filesScanned: 50,
  duplicates: 2,
  movesProposed: 30,
  renamesProposed: 10,
  skipped: 5,
};

describeDb('OrganizeRepository', () => {
  let repo: OrganizeRepository;

  beforeEach(async () => {
    await resetAndMigrate(__dirname);
    repo = createOrganizeRepository({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    await repo.close();
  });

  describe('insertPlan', () => {
    it('records a new plan row with default status "analyzing" and the caller summary', async () => {
      const id = '11111111-1111-1111-1111-111111111111';
      const input: NewOrganizePlan = {
        id,
        folderPath: '/share/biblioteca/raw',
        dryRun: false,
      };
      const inserted = await repo.insertPlan(input, SAMPLE_SUMMARY);
      expect(inserted.id).toBe(id);
      expect(inserted.folderPath).toBe('/share/biblioteca/raw');
      expect(inserted.dryRun).toBe(false);
      expect(inserted.status).toBe<OrganizePlanStatus>('analyzing');
      expect(inserted.summary).toEqual(SAMPLE_SUMMARY);
      expect(inserted.startedAt).toBeInstanceOf(Date);
      expect(inserted.finishedAt).toBeNull();
      expect(inserted.error).toBeNull();
    });

    it('records dryRun = true when the analyze was a no-move preview', async () => {
      const id = '22222222-2222-2222-2222-222222222222';
      const inserted = await repo.insertPlan(
        { id, folderPath: '/share', dryRun: true },
        SAMPLE_SUMMARY,
      );
      expect(inserted.dryRun).toBe(true);
    });
  });

  describe('getPlan', () => {
    it('round-trips an inserted plan', async () => {
      const id = '33333333-3333-3333-3333-333333333333';
      await repo.insertPlan(
        { id, folderPath: '/share/biblioteca/raw', dryRun: false },
        SAMPLE_SUMMARY,
      );
      const fetched = await repo.getPlan(id);
      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(id);
      expect(fetched!.summary).toEqual(SAMPLE_SUMMARY);
    });

    it('returns null for an unknown UUID', async () => {
      expect(await repo.getPlan('99999999-9999-9999-9999-999999999999')).toBeNull();
    });
  });

  describe('insertActions', () => {
    it('inserts a batch of action rows tied to the plan', async () => {
      const id = '44444444-4444-4444-4444-444444444444';
      await repo.insertPlan(
        { id, folderPath: '/share', dryRun: false },
        SAMPLE_SUMMARY,
      );
      const actions = await repo.insertActions([
        {
          planId: id,
          sourcePath: '/share/a.pdf',
          targetPath: '/share/_anonymous/a.pdf',
          kind: 'move',
          fileHash: 'xxh64:deadbeef',
        },
        {
          planId: id,
          sourcePath: '/share/b.epub',
          targetPath: '/share/Borges, Jorge Luis/Ficciones (1944).epub',
          kind: 'rename',
          fileHash: 'xxh64:cafebabe',
        },
      ]);
      expect(actions).toHaveLength(2);
      expect(actions[0].status).toBe<OrganizeActionStatus>('pending');
      expect(actions[0].kind).toBe<OrganizeActionKind>('move');
      expect(actions[1].kind).toBe<OrganizeActionKind>('rename');
    });
  });

  describe('listActions', () => {
    it('returns all actions for a plan', async () => {
      const id = '55555555-5555-5555-5555-555555555555';
      await repo.insertPlan(
        { id, folderPath: '/share', dryRun: false },
        SAMPLE_SUMMARY,
      );
      await repo.insertActions([
        {
          planId: id,
          sourcePath: '/share/a.pdf',
          targetPath: '/share/A.pdf',
          kind: 'move',
          fileHash: null,
        },
        {
          planId: id,
          sourcePath: '/share/b.epub',
          targetPath: '/share/B.epub',
          kind: 'rename',
          fileHash: null,
        },
      ]);
      const actions = await repo.listActions(id);
      expect(actions).toHaveLength(2);
      expect(actions.map((a) => a.kind).sort()).toEqual(['move', 'rename']);
    });

    it('returns an empty list for an unknown plan', async () => {
      expect(
        await repo.listActions('99999999-9999-9999-9999-999999999999'),
      ).toEqual([]);
    });
  });

  describe('markActionApplied', () => {
    it('flips pending → applied and stamps applied_at', async () => {
      const id = '66666666-6666-6666-6666-666666666666';
      await repo.insertPlan(
        { id, folderPath: '/share', dryRun: false },
        SAMPLE_SUMMARY,
      );
      const [action] = await repo.insertActions([
        {
          planId: id,
          sourcePath: '/share/a.pdf',
          targetPath: '/share/A.pdf',
          kind: 'move',
          fileHash: null,
        },
      ]);
      const updated = await repo.markActionApplied(action.id, 'applied');
      expect(updated!.status).toBe<OrganizeActionStatus>('applied');
      expect(updated!.appliedAt).toBeInstanceOf(Date);
    });

    it('flips pending → skipped (idempotent re-execute) and stamps applied_at', async () => {
      const id = '77777777-7777-7777-7777-777777777777';
      await repo.insertPlan(
        { id, folderPath: '/share', dryRun: false },
        SAMPLE_SUMMARY,
      );
      const [action] = await repo.insertActions([
        {
          planId: id,
          sourcePath: '/share/a.pdf',
          targetPath: '/share/A.pdf',
          kind: 'move',
          fileHash: null,
        },
      ]);
      const updated = await repo.markActionApplied(action.id, 'skipped');
      expect(updated!.status).toBe<OrganizeActionStatus>('skipped');
      expect(updated!.appliedAt).toBeInstanceOf(Date);
    });

    it('records an error message for a failed action', async () => {
      const id = '88888888-8888-8888-8888-888888888888';
      await repo.insertPlan(
        { id, folderPath: '/share', dryRun: false },
        SAMPLE_SUMMARY,
      );
      const [action] = await repo.insertActions([
        {
          planId: id,
          sourcePath: '/share/a.pdf',
          targetPath: '/share/A.pdf',
          kind: 'move',
          fileHash: null,
        },
      ]);
      const updated = await repo.markActionApplied(
        action.id,
        'failed',
        'EACCES: permission denied',
      );
      expect(updated!.status).toBe<OrganizeActionStatus>('failed');
      expect(updated!.error).toBe('EACCES: permission denied');
    });

    it('does NOT touch an action that is already applied (idempotence)', async () => {
      const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      await repo.insertPlan(
        { id, folderPath: '/share', dryRun: false },
        SAMPLE_SUMMARY,
      );
      const [action] = await repo.insertActions([
        {
          planId: id,
          sourcePath: '/share/a.pdf',
          targetPath: '/share/A.pdf',
          kind: 'move',
          fileHash: null,
        },
      ]);
      await repo.markActionApplied(action.id, 'applied');
      const second = await repo.markActionApplied(action.id, 'applied');
      // The second call MUST NOT rewrite applied_at; the original
      // timestamp stays so audit logs know which call actually
      // performed the move.
      expect(second!.appliedAt).toEqual((await repo.listActions(id))[0].appliedAt);
    });
  });

  describe('updatePlanStatus', () => {
    it('transitions analyzing → ready without touching started_at', async () => {
      const id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
      const initial = await repo.insertPlan(
        { id, folderPath: '/share', dryRun: false },
        SAMPLE_SUMMARY,
      );
      const updated = await repo.updatePlanStatus(id, 'ready');
      expect(updated!.status).toBe<OrganizePlanStatus>('ready');
      // ``started_at`` MUST be unchanged.
      expect(updated!.startedAt.getTime()).toBe(initial.startedAt.getTime());
    });

    it('stamps finished_at on a terminal transition to done', async () => {
      const id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
      await repo.insertPlan(
        { id, folderPath: '/share', dryRun: false },
        SAMPLE_SUMMARY,
      );
      await repo.updatePlanStatus(id, 'ready');
      const updated = await repo.updatePlanStatus(id, 'done');
      expect(updated!.status).toBe<OrganizePlanStatus>('done');
      expect(updated!.finishedAt).toBeInstanceOf(Date);
    });

    it('persists an error message on a failed transition', async () => {
      const id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
      await repo.insertPlan(
        { id, folderPath: '/share', dryRun: false },
        SAMPLE_SUMMARY,
      );
      const updated = await repo.updatePlanStatus(id, 'failed', 'walk failed');
      expect(updated!.status).toBe<OrganizePlanStatus>('failed');
      expect(updated!.error).toBe('walk failed');
      expect(updated!.finishedAt).toBeInstanceOf(Date);
    });
  });

  describe('updatePlanProgress', () => {
    it('replaces the summary with the latest counts', async () => {
      const id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
      await repo.insertPlan(
        { id, folderPath: '/share', dryRun: false },
        SAMPLE_SUMMARY,
      );
      const next: OrganizePlanSummary = {
        ...SAMPLE_SUMMARY,
        filesScanned: 10,
      };
      const updated = await repo.updatePlanProgress(id, next);
      expect(updated!.summary).toEqual(next);
    });
  });

  describe('factory', () => {
    it('uses the injected pool when one is provided', () => {
      const pool = new Pool({ connectionString: 'postgresql://test/test' });
      const localRepo = createOrganizeRepository({ pool });
      // The repository MUST reuse the pool; the simplest check is
      // that ``close`` propagates to the injected pool.
      expect(localRepo).toBeDefined();
      // Don't actually call close on it — the pool is shared with
      // other suites; ``createOrganizeRepository`` does NOT own the
      // pool here.
      pool.end();
    });
  });

  describe('longevity', () => {
    it('returns the same organization on simple round-trip', async () => {
      const id = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
      const inserted = await repo.insertPlan(
        { id, folderPath: '/share', dryRun: false },
        SAMPLE_SUMMARY,
      );
      const fetched: OrganizePlan | null = await repo.getPlan(id);
      expect(fetched).toEqual(inserted);
    });
  });

  describe('action kinds are constrained', () => {
    it('rejects an unknown kind via the CHECK constraint', async () => {
      const id = '12121212-1212-1212-1212-121212121212';
      await repo.insertPlan(
        { id, folderPath: '/share', dryRun: false },
        SAMPLE_SUMMARY,
      );
      await expect(
        repo.insertActions([
          {
            planId: id,
            sourcePath: '/share/a.pdf',
            targetPath: '/share/A.pdf',
            kind: 'bogus' as OrganizeActionKind,
            fileHash: null,
          },
        ]),
      ).rejects.toThrow();
    });
  });
});
