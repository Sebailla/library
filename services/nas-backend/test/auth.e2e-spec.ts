import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DEVICES_REPOSITORY } from '../src/auth/devices.repository';

/**
 * End-to-end contract tests for the auth pair + refresh endpoints
 * (PR-2C, work unit 1).
 *
 *   POST /api/auth/pair    {pin, device_name} → 201 {token, expires_at, device_id}
 *   POST /api/auth/refresh {token}            → 201 {token, expires_at}
 *
 * Both endpoints are public. The sample protected route lives in
 * ``me.e2e-spec.ts`` and exercises the JWT guard.
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

async function buildApp(opts: {
  pin?: string;
  ttlDays?: number;
  jwtSecret?: string;
  jwtTtlHours?: number;
} = {}): Promise<{
  app: INestApplication;
  devices: InMemoryDevicesRepository;
}> {
  setEnv({
    NAS_PAIR_PIN: opts.pin ?? '0000',
    NAS_PIN_TTL_DAYS: String(opts.ttlDays ?? '30'),
    NAS_JWT_SECRET: opts.jwtSecret ?? 'test-secret-do-not-use-in-prod',
    NAS_JWT_TTL_HOURS: String(opts.jwtTtlHours ?? '24'),
  });
  const devices = new InMemoryDevicesRepository();
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(DEVICES_REPOSITORY)
    .useValue(devices)
    .compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return { app, devices };
}

describe('POST /api/auth/pair', () => {
  afterEach(() => {
    restoreEnv();
  });

  it('returns 201 with {token, expires_at, device_id} on valid PIN', async () => {
    const { app } = await buildApp({ pin: '123456' });
    try {
      const res = await request(app.getHttpServer())
        .post('/api/auth/pair')
        .send({ pin: '123456', device_name: 'iPad de Seba' })
        .expect(201);
      expect(typeof res.body.token).toBe('string');
      expect(res.body.token.split('.')).toHaveLength(3); // JWT format
      expect(typeof res.body.expires_at).toBe('string');
      const expiresAt = new Date(res.body.expires_at).toISOString();
      expect(expiresAt).toBe(res.body.expires_at);
      // expires_at must be in the future.
      expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());
      expect(typeof res.body.device_id).toBe('string');
      expect(res.body.device_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    } finally {
      await app.close();
    }
  });

  it('returns 401 BAD_PIN on invalid PIN', async () => {
    const { app } = await buildApp({ pin: '123456' });
    try {
      const res = await request(app.getHttpServer())
        .post('/api/auth/pair')
        .send({ pin: '000000', device_name: 'X' })
        .expect(401);
      expect(res.body.error).toMatchObject({ code: 'BAD_PIN' });
    } finally {
      await app.close();
    }
  });

  it('returns 401 PIN_EXPIRED when the PIN TTL is in the past', async () => {
    // A negative TTL models "the PIN window has closed"; the
    // service MUST surface that as ``PIN_EXPIRED`` rather than a
    // generic 500.
    const { app } = await buildApp({ pin: '123456', ttlDays: -1 });
    try {
      const res = await request(app.getHttpServer())
        .post('/api/auth/pair')
        .send({ pin: '123456', device_name: 'X' })
        .expect(401);
      expect(res.body.error).toMatchObject({ code: 'PIN_EXPIRED' });
    } finally {
      await app.close();
    }
  });

  it('persists a device row keyed by the returned device_id', async () => {
    const { app, devices } = await buildApp({ pin: '123456' });
    try {
      const res = await request(app.getHttpServer())
        .post('/api/auth/pair')
        .send({ pin: '123456', device_name: 'iPad de Seba' })
        .expect(201);
      const stored = await devices.findByDeviceId(res.body.device_id);
      expect(stored).not.toBeNull();
      expect(stored?.deviceName).toBe('iPad de Seba');
      expect(stored?.tokenHash).not.toBe(res.body.token); // bcrypt hash, not raw JWT
      expect((stored?.tokenHash ?? '').length).toBeGreaterThan(20);
    } finally {
      await app.close();
    }
  });
});

describe('POST /api/auth/refresh', () => {
  afterEach(() => {
    restoreEnv();
  });

  it('returns 201 with a new token when given a valid Bearer', async () => {
    const secret = 'test-secret-do-not-use-in-prod';
    const { app } = await buildApp({ jwtSecret: secret });
    try {
      const pair = await request(app.getHttpServer())
        .post('/api/auth/pair')
        .send({ pin: '0000', device_name: 'iPad' })
        .expect(201);
      const oldToken = pair.body.token as string;

      const refreshed = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ token: oldToken })
        .expect(201);
      expect(typeof refreshed.body.token).toBe('string');
      expect(refreshed.body.token).not.toBe(oldToken);
      expect(typeof refreshed.body.expires_at).toBe('string');
    } finally {
      await app.close();
    }
  });
});
