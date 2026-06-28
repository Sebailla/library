import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DEVICES_REPOSITORY } from '../src/auth/devices.repository';
import { buildValidationPipe } from '../src/common/validation.pipe';

/**
 * End-to-end contract tests for the protected sample route
 * ``GET /api/me`` (PR-2C, work unit 2).
 *
 * The route demonstrates the ``JwtAuthGuard``:
 *
 *   - No Bearer        → 401 UNAUTHORIZED
 *   - Tampered Bearer  → 401 TOKEN_INVALID
 *   - Valid Bearer     → 200 {device_id, device_name}
 *
 * ``DevicesRepository`` is stubbed in-process so the suite does
 * not need a live Postgres to verify the contract.
 */

const ORIGINAL_ENV = { ...process.env };

function setEnv(overrides: Record<string, string>): void {
  for (const [k, v] of Object.entries(overrides)) {
    process.env[k] = v;
  }
}

function restoreEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  }
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    process.env[k] = v;
  }
}

/** In-memory ``DevicesRepository`` faithful to the contract below. */
class InMemoryDevicesRepository {
  private readonly rows: Array<{
    deviceId: string;
    deviceName: string | null;
    tokenHash: string;
    pairedAt: Date;
    lastSeenAt: Date | null;
    ipAddress: string | null;
  }> = [];

  async insert(row: {
    deviceId: string;
    deviceName: string | null;
    tokenHash: string;
    ipAddress: string | null;
  }): Promise<{ deviceId: string; pairedAt: Date }> {
    const pairedAt = new Date();
    this.rows.push({
      deviceId: row.deviceId,
      deviceName: row.deviceName,
      tokenHash: row.tokenHash,
      ipAddress: row.ipAddress,
      pairedAt,
      lastSeenAt: null,
    });
    return { deviceId: row.deviceId, pairedAt };
  }

  async findByDeviceId(deviceId: string): Promise<{
    deviceId: string;
    deviceName: string | null;
    tokenHash: string;
    pairedAt: Date;
    lastSeenAt: Date | null;
    ipAddress: string | null;
  } | null> {
    return this.rows.find((r) => r.deviceId === deviceId) ?? null;
  }

  async updateTokenHash(deviceId: string, tokenHash: string): Promise<void> {
    const row = this.rows.find((r) => r.deviceId === deviceId);
    if (row) row.tokenHash = tokenHash;
  }

  async touch(deviceId: string): Promise<void> {
    const row = this.rows.find((r) => r.deviceId === deviceId);
    if (row) row.lastSeenAt = new Date();
  }

  async close(): Promise<void> {
    /* no-op */
  }
}

async function buildApp(): Promise<{
  app: INestApplication;
  devices: InMemoryDevicesRepository;
}> {
  setEnv({
    NAS_PAIR_PIN: '12345678',
    NAS_PIN_TTL_DAYS: '30',
    NAS_JWT_SECRET: 'test-secret-do-not-use-in-prod-must-be-32+bytes',
    NAS_JWT_TTL_HOURS: '24',
  });
  const devices = new InMemoryDevicesRepository();
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(DEVICES_REPOSITORY)
    .useValue(devices)
    .compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(buildValidationPipe());
  await app.init();
  return { app, devices };
}

describe('GET /api/me (sample protected route)', () => {
  afterEach(() => {
    restoreEnv();
  });

  it('returns 401 UNAUTHORIZED with no Authorization header', async () => {
    const { app } = await buildApp();
    try {
      const res = await request(app.getHttpServer())
        .get('/api/me')
        .expect(401);
      expect(res.body.error).toMatchObject({ code: 'UNAUTHORIZED' });
    } finally {
      await app.close();
    }
  });

  it('returns 200 with {device_id, device_name} for a valid Bearer token', async () => {
    const { app } = await buildApp();
    try {
      const pair = await request(app.getHttpServer())
        .post('/api/auth/pair')
        .send({ pin: '12345678', device_name: 'iPad de Seba' })
        .expect(201);
      const res = await request(app.getHttpServer())
        .get('/api/me')
        .set('Authorization', `Bearer ${pair.body.token}`)
        .expect(200);
      expect(res.body.device_id).toBe(pair.body.device_id);
      expect(res.body.device_name).toBe('iPad de Seba');
    } finally {
      await app.close();
    }
  });

  it('returns 401 TOKEN_INVALID for a tampered Bearer token', async () => {
    const { app } = await buildApp();
    try {
      const pair = await request(app.getHttpServer())
        .post('/api/auth/pair')
        .send({ pin: '12345678', device_name: 'iPad' })
        .expect(201);
      const tampered = pair.body.token.slice(0, -3) + 'AAA';
      const res = await request(app.getHttpServer())
        .get('/api/me')
        .set('Authorization', `Bearer ${tampered}`)
        .expect(401);
      expect(res.body.error.code).toMatch(/TOKEN_INVALID|TOKEN_EXPIRED/);
    } finally {
      await app.close();
    }
  });
});
