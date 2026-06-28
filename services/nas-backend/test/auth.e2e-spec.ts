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
  pin?: string | undefined;
  /** When true, leave NAS_PAIR_PIN untouched instead of writing a default. */
  pinUnset?: boolean;
  ttlDays?: number;
  jwtSecret?: string;
  jwtTtlHours?: number;
} = {}): Promise<{
  app: INestApplication;
  devices: InMemoryDevicesRepository;
}> {
  const envOverrides: Record<string, string> = {
    NAS_PIN_TTL_DAYS: String(opts.ttlDays ?? '30'),
    NAS_JWT_SECRET: opts.jwtSecret ?? 'test-secret-do-not-use-in-prod-must-be-32+bytes',
    NAS_JWT_TTL_HOURS: String(opts.jwtTtlHours ?? '24'),
  };
  if (opts.pinUnset) {
    delete process.env.NAS_PAIR_PIN;
  } else {
    envOverrides.NAS_PAIR_PIN = opts.pin ?? '12345678';
  }
  setEnv(envOverrides);
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

/**
 * Build a module WITHOUT setting a NAS_JWT_SECRET — used by the
 * security fail-fast tests below. The caller is responsible for
 * ensuring the env var is unset (we strip it explicitly so a
 * CI default value cannot mask the bug under test).
 */
async function tryBuildAppWithoutSecret(): Promise<{
  ok: true;
  app: INestApplication;
  devices: InMemoryDevicesRepository;
} | {
  ok: false;
  err: unknown;
}> {
  // Strip the secret so the auth module sees an unset env var.
  delete process.env.NAS_JWT_SECRET;
  const devices = new InMemoryDevicesRepository();
  try {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DEVICES_REPOSITORY)
      .useValue(devices)
      .compile();
    const app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    return { ok: true, app, devices };
  } catch (err) {
    return { ok: false, err };
  }
}

describe('POST /api/auth/pair', () => {
  afterEach(() => {
    restoreEnv();
  });

  it('returns 201 with {token, expires_at, device_id} on valid PIN', async () => {
    const { app } = await buildApp({ pin: '12345678' });
    try {
      const res = await request(app.getHttpServer())
        .post('/api/auth/pair')
        .send({ pin: '12345678', device_name: 'iPad de Seba' })
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
    const { app } = await buildApp({ pin: '12345678' });
    try {
      const res = await request(app.getHttpServer())
        .post('/api/auth/pair')
        .send({ pin: '99999999', device_name: 'X' })
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
    const { app } = await buildApp({ pin: '12345678', ttlDays: -1 });
    try {
      const res = await request(app.getHttpServer())
        .post('/api/auth/pair')
        .send({ pin: '12345678', device_name: 'X' })
        .expect(401);
      expect(res.body.error).toMatchObject({ code: 'PIN_EXPIRED' });
    } finally {
      await app.close();
    }
  });

  it('persists a device row keyed by the returned device_id', async () => {
    const { app, devices } = await buildApp({ pin: '12345678' });
    try {
      const res = await request(app.getHttpServer())
        .post('/api/auth/pair')
        .send({ pin: '12345678', device_name: 'iPad de Seba' })
        .expect(201);
      const stored = await devices.findByDeviceId(res.body.device_id);
      expect(stored).not.toBeNull();
      expect(stored?.deviceName).toBe('iPad de Seba');
      expect(stored?.tokenHash).not.toBe(res.body.token); // SHA-256 hash, not raw JWT
      // SHA-256 hex is exactly 64 chars.
      expect(stored?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
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
    const secret = 'test-secret-do-not-use-in-prod-must-be-32+bytes';
    const { app } = await buildApp({ jwtSecret: secret });
    try {
      const pair = await request(app.getHttpServer())
        .post('/api/auth/pair')
        .send({ pin: '12345678', device_name: 'iPad' })
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

  it('invalidates the old token immediately after refresh', async () => {
    const { app } = await buildApp();
    try {
      const pair = await request(app.getHttpServer())
        .post('/api/auth/pair')
        .send({ pin: '12345678', device_name: 'iPad' })
        .expect(201);
      const oldToken = pair.body.token as string;

      // Refresh rotates T1 → T2.
      const refreshed = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ token: oldToken })
        .expect(201);
      const newToken = refreshed.body.token as string;

      // T1 must no longer authenticate against ``/api/me``.
      const meOld = await request(app.getHttpServer())
        .get('/api/me')
        .set('Authorization', `Bearer ${oldToken}`)
        .expect(401);
      expect(meOld.body.error.code).toMatch(/TOKEN_INVALID|TOKEN_EXPIRED/);

      // T2 must still work — the device row was NOT deleted, only
      // its ``token_hash`` rotated.
      const meNew = await request(app.getHttpServer())
        .get('/api/me')
        .set('Authorization', `Bearer ${newToken}`)
        .expect(200);
      expect(meNew.body.device_id).toBe(pair.body.device_id);
    } finally {
      await app.close();
    }
  });
});

/**
 * Security contract tests for the auth module (#32, 4R review
 * blockers).
 *
 * The auth module MUST refuse to start when:
 *
 *   - ``NAS_JWT_SECRET`` is unset (no silent fallback to a public
 *     literal).
 *   - ``NAS_PAIR_PIN`` is unset or shorter than 8 characters.
 *
 * Boot-time validation is the only safe place for these checks —
 * a runtime check would let the API answer pair requests with the
 * default credentials and only fail later, which is exactly the
 * exposure this issue closes.
 */
describe('Auth module — boot-time security validation', () => {
  afterEach(() => {
    restoreEnv();
  });

  it('refuses to start when NAS_JWT_SECRET is unset', async () => {
    // Make sure the secret is genuinely missing — the existing
    // ``restoreEnv`` only restores keys that were present at module
    // load, so we also clear the env var explicitly.
    delete process.env.NAS_JWT_SECRET;
    process.env.NODE_ENV = 'production';
    const result = await tryBuildAppWithoutSecret();
    if (result.ok) {
      await result.app.close();
    }
    expect(result.ok).toBe(false);
    if (result.ok) return; // narrow for TS
    const message =
      result.err instanceof Error ? result.err.message : String(result.err);
    // The error must reference the missing env var so the operator
    // knows exactly what to fix.
    expect(message).toMatch(/NAS_JWT_SECRET/);
    delete process.env.NODE_ENV;
  });

  it('refuses to start when NAS_JWT_SECRET is shorter than 32 bytes', async () => {
    process.env.NODE_ENV = 'production';
    let threw = false;
    let message = '';
    try {
      // Explicit short secret (9 bytes) — the helper passes this
      // straight to setEnv so the test cannot be accidentally
      // masked by a long default.
      const { app } = await buildApp({ jwtSecret: 'too-short' });
      await app.close();
    } catch (err) {
      threw = true;
      message = err instanceof Error ? err.message : String(err);
    }
    expect(threw).toBe(true);
    expect(message).toMatch(/NAS_JWT_SECRET/);
    delete process.env.NODE_ENV;
  });

  it('refuses to start when NAS_PAIR_PIN is unset', async () => {
    process.env.NODE_ENV = 'production';
    let threw = false;
    let message = '';
    try {
      const { app } = await buildApp({ pinUnset: true });
      await app.close();
    } catch (err) {
      threw = true;
      message = err instanceof Error ? err.message : String(err);
    }
    expect(threw).toBe(true);
    expect(message).toMatch(/NAS_PAIR_PIN/);
    delete process.env.NODE_ENV;
  });

  it('refuses to start when NAS_PAIR_PIN is shorter than 8 characters', async () => {
    process.env.NODE_ENV = 'production';
    let threw = false;
    let message = '';
    try {
      // 4-character PIN — short enough to brute-force in seconds
      // and below the documented minimum length of 8.
      const { app } = await buildApp({ pin: '1234' });
      await app.close();
    } catch (err) {
      threw = true;
      message = err instanceof Error ? err.message : String(err);
    }
    expect(threw).toBe(true);
    expect(message).toMatch(/NAS_PAIR_PIN/);
    delete process.env.NODE_ENV;
  });
});
