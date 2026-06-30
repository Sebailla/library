import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { DEVICES_REPOSITORY } from '../../../src/auth/devices.repository';
import { LIBRARIES_REPOSITORY } from '../../../src/libraries/libraries.repository';
import {
  DEVICES_LOOKUP,
  LIBRARY_BOOK_COUNT,
} from '../../../src/libraries/libraries.service';
import { buildValidationPipe } from '../../../src/common/validation.pipe';
import {
  ORGANIZE_REPOSITORY,
  OrganizeRepository,
} from '../../../src/admin/organize/organize.repository';
import { FILE_MOVER } from '../../../src/admin/organize/organize.service';
import { OrganizeAction } from '../../../src/admin/organize/organize.types';
import { Library, NewLibrary } from '../../../src/libraries/libraries.types';

/**
 * End-to-end contract tests for the ``/api/admin/organize/*``
 * HTTP surface shipped in PR-N5.
 *
 *   POST  /api/admin/organize/analyze  → 200 { plan_id, summary, sample_actions[] }
 *   POST  /api/admin/organize/execute  → 200 { plan_id, summary }
 *   GET   /api/admin/organize/plans/:plan_id → 200 { plan, actions[] }
 *
 * Every route sits behind ``JwtAuthGuard`` + ``ScanAdminGuard``
 * (re-used: same admin gate per refactor #15). The repository
 * and the file mover are stubbed in-process so the suite pins
 * the HTTP contract without a live Postgres + pgroonga or
 * touching real NAS storage.
 */

const ORIGINAL_ENV = { ...process.env };

function setEnv(overrides: Record<string, string>): void {
  for (const [k, v] of Object.entries(overrides)) {
    process.env[k] = v;
  }
}

interface InMemoryDevice {
  deviceId: string;
  deviceName: string | null;
  tokenHash: string;
  pairedAt: Date;
  lastSeenAt: Date | null;
  ipAddress: string | null;
  isAdmin: boolean;
}

class InMemoryDevicesRepository {
  private rows: InMemoryDevice[] = [];

  async insert(row: Omit<InMemoryDevice, 'pairedAt' | 'lastSeenAt'>): Promise<InMemoryDevice> {
    const full: InMemoryDevice = {
      pairedAt: new Date(),
      lastSeenAt: null,
      ...row,
    };
    this.rows.push(full);
    return full;
  }

  async findByDeviceId(deviceId: string): Promise<InMemoryDevice | null> {
    return this.rows.find((r) => r.deviceId === deviceId) ?? null;
  }

  async updateTokenHash(): Promise<void> {}

  async touch(deviceId: string): Promise<void> {
    const row = this.rows.find((r) => r.deviceId === deviceId);
    if (row) row.lastSeenAt = new Date();
  }

  async isAdmin(deviceId: string): Promise<boolean> {
    return (this.rows.find((r) => r.deviceId === deviceId)?.isAdmin) === true;
  }

  async close(): Promise<void> {}
}

class InMemoryDeviceLookup {
  constructor(private readonly devices: InMemoryDevicesRepository) {}
  async findByDeviceId(deviceId: string): Promise<{ deviceId: string } | null> {
    const row = await this.devices.findByDeviceId(deviceId);
    return row ? { deviceId: row.deviceId } : null;
  }
}

class InMemoryLibrariesRepository {
  private rows: Library[] = [];
  private nextId = 1;

  async list(): Promise<Library[]> { return [...this.rows]; }
  async findById(id: number): Promise<Library | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async insert(library: NewLibrary): Promise<Library> {
    const row: Library = { id: this.nextId++, ...library, createdAt: new Date() };
    this.rows.push(row);
    return row;
  }
  async update(): Promise<Library | null> { return null; }
  async delete(): Promise<boolean> { return true; }
  async setActiveForDevice(): Promise<void> {}
  async getActiveForDevice(): Promise<Library | null> { return null; }
  async listForDevice(): Promise<unknown[]> { return []; }
  async close(): Promise<void> {}
}

class InMemoryBookCount {
  async countByLibrary(): Promise<number> { return 0; }
}

interface StoredPlan {
  id: string;
  folderPath: string;
  dryRun: boolean;
  status: string;
  summary: unknown;
  startedAt: Date;
  finishedAt: Date | null;
  error: string | null;
}

class InMemoryOrganizeRepository {
  private plans = new Map<string, StoredPlan>();
  private actionsByPlan = new Map<string, OrganizeAction[]>();
  private nextActionId = 1;

  async insertPlan(
    plan: { planId: string; folderPath: string; dryRun: boolean },
    summary: unknown,
  ): Promise<StoredPlan> {
    const row: StoredPlan = {
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

  async getPlan(id: string): Promise<StoredPlan | null> {
    return this.plans.get(id) ?? null;
  }

  async insertActions(
    actions: Array<{
      planId: string;
      sourcePath: string;
      targetPath: string;
      kind: OrganizeAction['kind'];
      fileHash: string | null;
    }>,
  ): Promise<OrganizeAction[]> {
    const result: OrganizeAction[] = [];
    const list: OrganizeAction[] = this.actionsByPlan.get(actions[0].planId) ?? [];
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
      list.push(row);
      result.push(row);
    }
    this.actionsByPlan.set(actions[0].planId, list);
    return result;
  }

  async listActions(planId: string): Promise<OrganizeAction[]> {
    return [...(this.actionsByPlan.get(planId) ?? [])];
  }

  async markActionApplied(
    id: number,
    status: 'applied' | 'skipped' | 'failed',
    error?: string,
  ): Promise<OrganizeAction | null> {
    for (const list of this.actionsByPlan.values()) {
      const row = list.find((a) => a.id === id);
      if (row) {
        if (row.status === 'pending') {
          row.status = status;
          row.error = error ?? null;
          if (status === 'applied' || status === 'skipped') {
            row.appliedAt = new Date();
          }
        }
        return row;
      }
    }
    return null;
  }

  async updatePlanStatus(id: string, status: string, error?: string): Promise<StoredPlan | null> {
    const row = this.plans.get(id);
    if (!row) return null;
    row.status = status;
    row.error = error ?? null;
    if (status === 'done' || status === 'failed') row.finishedAt = new Date();
    return row;
  }

  async updatePlanProgress(id: string, summary: unknown): Promise<StoredPlan | null> {
    const row = this.plans.get(id);
    if (!row) return null;
    row.summary = summary;
    return row;
  }

  async close(): Promise<void> {}
}

class RecordingFileMover {
  public moves: Array<{ source: string; target: string }> = [];
  public targetExists = new Set<string>();

  setTargetExists(filePath: string): void {
    this.targetExists.add(filePath);
  }

  async move(source: string, target: string): Promise<'moved' | 'skipped' | 'error'> {
    if (this.targetExists.has(target)) return 'skipped';
    this.moves.push({ source, target });
    this.targetExists.add(target);
    return 'moved';
  }

  async ensureDir(dirPath: string): Promise<void> {
    void dirPath;
  }
}

function buildApp(): Promise<{
  app: INestApplication;
  devices: InMemoryDevicesRepository;
  organizer: InMemoryOrganizeRepository;
  mover: RecordingFileMover;
}> {
  setEnv({
    NAS_PAIR_PIN: '12345678',
    NAS_PIN_TTL_DAYS: '30',
    NAS_JWT_SECRET: 'test-secret-do-not-use-in-prod-must-be-32+bytes',
    NAS_JWT_TTL_HOURS: '24',
  });
  const devices = new InMemoryDevicesRepository();
  const libraries = new InMemoryLibrariesRepository();
  const organizer = new InMemoryOrganizeRepository();
  const mover = new RecordingFileMover();
  return (async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DEVICES_REPOSITORY)
      .useValue(devices)
      .overrideProvider(DEVICES_LOOKUP)
      .useValue(new InMemoryDeviceLookup(devices))
      .overrideProvider(LIBRARIES_REPOSITORY)
      .useValue(libraries)
      .overrideProvider(LIBRARY_BOOK_COUNT)
      .useValue(new InMemoryBookCount())
      .overrideProvider(ORGANIZE_REPOSITORY)
      .useValue(organizer as unknown as OrganizeRepository)
      .overrideProvider(FILE_MOVER)
      .useValue({
        move: (s: string, t: string) => mover.move(s, t),
        ensureDir: (d: string) => mover.ensureDir(d),
      })
      .compile();
    const app = moduleRef.createNestApplication();
    app.useGlobalPipes(buildValidationPipe());
    await app.init();
    return { app, devices, organizer, mover };
  })();
}

async function pairAndGetToken(
  app: INestApplication,
  devices: InMemoryDevicesRepository,
  isAdmin: boolean,
): Promise<string> {
  const pair = await request(app.getHttpServer())
    .post('/api/auth/pair')
    .send({ pin: '12345678', device_name: 'TestDevice' })
    .expect(201);
  const token = pair.body.token as string;
  if (isAdmin) {
    const deviceId = pair.body.device_id as string;
    const row = await devices.findByDeviceId(deviceId);
    if (row) row.isAdmin = true;
  }
  return token;
}

describe('OrganizeController (e2e)', () => {
  let app: INestApplication;
  let devices: InMemoryDevicesRepository;
  let organizer: InMemoryOrganizeRepository;
  let mover: RecordingFileMover;
  let adminToken: string;
  let nonAdminToken: string;

  beforeAll(async () => {
    const built = await buildApp();
    app = built.app;
    devices = built.devices;
    organizer = built.organizer;
    mover = built.mover;
    adminToken = await pairAndGetToken(app, devices, true);
    nonAdminToken = await pairAndGetToken(app, devices, false);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('analyze rejects anonymous requests with 401', async () => {
    await request(app.getHttpServer())
      .post('/api/admin/organize/analyze')
      .send({ folder_path: '/share/biblioteca/raw' })
      .expect(401);
  });

  it('analyze rejects a non-admin device with 403 ADMIN_REQUIRED', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/admin/organize/analyze')
      .set('Authorization', `Bearer ${nonAdminToken}`)
      .send({ folder_path: '/share/biblioteca/raw' })
      .expect(403);
    expect(res.body.error.code).toBe('ADMIN_REQUIRED');
  });

  it('analyze accepts an admin request, persists the plan, and returns plan_id + summary', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/admin/organize/analyze')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        folder_path: '/share/biblioteca/raw',
        dry_run: false,
        proposed_actions: [
          {
            source_path: '/share/biblioteca/raw/misc/a.pdf',
            target_path: '/share/biblioteca/raw/Borges, Jorge Luis/Ficciones (1944).pdf',
            kind: 'move',
            file_hash: 'xxh64:abc',
          },
          {
            source_path: '/share/biblioteca/raw/a.pdf',
            target_path: '/share/biblioteca/raw/A.pdf',
            kind: 'rename',
            file_hash: 'xxh64:def',
          },
        ],
      })
      .expect(201);
    expect(res.body.plan_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.summary.files_scanned).toBe(2);
    expect(res.body.summary.moves_proposed).toBe(1);
    expect(res.body.summary.renames_proposed).toBe(1);
    expect(Array.isArray(res.body.sample_actions)).toBe(true);
  });

  it('GET plans/:id returns the plan + actions tree', async () => {
    // First create a plan.
    const created = await request(app.getHttpServer())
      .post('/api/admin/organize/analyze')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        folder_path: '/share/biblioteca/raw',
        proposed_actions: [
          {
            source_path: '/share/a.pdf',
            target_path: '/share/A.pdf',
            kind: 'rename',
            file_hash: null,
          },
        ],
      })
      .expect(201);
    const planId: string = created.body.plan_id;
    const res = await request(app.getHttpServer())
      .get(`/api/admin/organize/plans/${planId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.plan.id).toBe(planId);
    expect(res.body.actions).toHaveLength(1);
    expect(res.body.actions[0].source_path).toBe('/share/a.pdf');
  });

  it('GET plans/:id returns 404 for an unknown plan', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/organize/plans/99999999-9999-9999-9999-999999999999')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);
  });

  it('execute moves each approved action and is idempotent on a second call', async () => {
    // Plan with one move.
    const created = await request(app.getHttpServer())
      .post('/api/admin/organize/analyze')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        folder_path: '/share',
        proposed_actions: [
          {
            source_path: '/share/a.pdf',
            target_path: '/share/A.pdf',
            kind: 'rename',
            file_hash: null,
          },
        ],
      })
      .expect(201);
    const planId: string = created.body.plan_id;
    const first = await request(app.getHttpServer())
      .post('/api/admin/organize/execute')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ plan_id: planId, approved_action_ids: [] })
      .expect(200);
    expect(first.body.summary.applied).toBe(1);
    expect(mover.moves.length).toBe(1);
    // Second execute: nothing to do.
    const second = await request(app.getHttpServer())
      .post('/api/admin/organize/execute')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ plan_id: planId, approved_action_ids: [] })
      .expect(200);
    expect(second.body.summary.applied).toBe(0);
    expect(mover.moves.length).toBe(1);
  });

  it('execute with a target that already exists records as skipped', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/admin/organize/analyze')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        folder_path: '/share',
        proposed_actions: [
          {
            source_path: '/share/a.pdf',
            target_path: '/share/pre-existing.pdf',
            kind: 'rename',
            file_hash: null,
          },
        ],
      })
      .expect(201);
    mover.setTargetExists('/share/pre-existing.pdf');
    const planId: string = created.body.plan_id;
    const res = await request(app.getHttpServer())
      .post('/api/admin/organize/execute')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ plan_id: planId, approved_action_ids: [] })
      .expect(200);
    expect(res.body.summary.applied).toBe(0);
    expect(res.body.summary.skipped).toBe(1);
  });

  it('execute rejects a dry_run plan (cannot move a plan recorded as preview only)', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/admin/organize/analyze')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        folder_path: '/share',
        dry_run: true,
        proposed_actions: [
          {
            source_path: '/share/a.pdf',
            target_path: '/share/A.pdf',
            kind: 'rename',
            file_hash: null,
          },
        ],
      })
      .expect(201);
    const planId: string = created.body.plan_id;
    await request(app.getHttpServer())
      .post('/api/admin/organize/execute')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ plan_id: planId, approved_action_ids: [] })
      .expect(400);
  });

  it('execute on an unknown plan returns 400 NO_PLAN', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/admin/organize/execute')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        plan_id: '00000000-0000-4000-8000-000000000000',
        approved_action_ids: [],
      })
      .expect(400);
    expect(res.body.error.code).toBe('NO_PLAN');
  });
});
