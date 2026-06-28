import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DEVICES_REPOSITORY } from '../src/auth/devices.repository';

/**
 * End-to-end contract tests for rate limiting on the public auth
 * and discovery endpoints (#34, 4R review).
 *
 *   POST /api/auth/pair         — 5 attempts / minute / IP
 *   POST /api/auth/refresh      — 10 attempts / minute / IP
 *   GET  /api/discovery/info    — 60 requests / minute / IP
 *
 * Each test exercises the limit by hammering the endpoint until
 * the throttler returns 429 with the documented ``THROTTLED``
 * error code. The storage is the in-memory default so the suite
 * stays hermetic.
 *
 * ``DevicesRepository`` is stubbed so pair can succeed without
 * Postgres; refresh tests do not need to mint a real token
 * because the throttler fires before the service runs.
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

/** In-memory ``DevicesRepository`` faithful to the contract. */
class InMemoryDevicesRepository {
  async insert(): Promise<{ deviceId: string; pairedAt: Date }> {
    return { deviceId: 'noop', pairedAt: new Date() };
  }
  async findByDeviceId(): Promise<unknown> {
    return null;
  }
  async updateTokenHash(): Promise<void> {
    /* no-op */
  }
  async touch(): Promise<void> {
    /* no-op */
  }
  async close(): Promise<void> {
    /* no-op */
  }
}

async function buildApp(): Promise<INestApplication> {
  setEnv({
    NAS_PAIR_PIN: '12345678',
    NAS_PIN_TTL_DAYS: '30',
    NAS_JWT_SECRET: 'test-secret-do-not-use-in-prod-must-be-32+bytes',
    NAS_JWT_TTL_HOURS: '24',
  });
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(DEVICES_REPOSITORY)
    .useValue(new InMemoryDevicesRepository())
    .compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return app;
}

describe('Rate limiting (#34)', () => {
  afterEach(() => {
    restoreEnv();
  });

  it('POST /api/auth/pair returns 429 after 5 attempts within a minute', async () => {
    const app = await buildApp();
    try {
      // The first five attempts are accepted (even when the PIN is
      // wrong the rate-limit window is what we are pinning here).
      // supertest does not share the IP across requests by default,
      // but the throttler tracks by the request IP which is set
      // automatically when the request is initiated from
      // 127.0.0.1 in jest.
      for (let i = 0; i < 5; i++) {
        const res = await request(app.getHttpServer())
          .post('/api/auth/pair')
          .send({ pin: 'wrong-pin-1234', device_name: 'X' });
        expect(res.status).toBeLessThanOrEqual(401); // 401 or 429 fine here
      }
      // The 6th attempt MUST be throttled.
      const blocked = await request(app.getHttpServer())
        .post('/api/auth/pair')
        .send({ pin: 'wrong-pin-1234', device_name: 'X' })
        .expect(429);
      expect(blocked.body).toMatchObject({
        error: { code: 'THROTTLED' },
      });
    } finally {
      await app.close();
    }
  });

  it('POST /api/auth/refresh returns 429 after 10 attempts within a minute', async () => {
    const app = await buildApp();
    try {
      for (let i = 0; i < 10; i++) {
        const res = await request(app.getHttpServer())
          .post('/api/auth/refresh')
          .send({ token: 'a.b.c' });
        // Each call fails token validation (401) but counts against
        // the rate limit window.
        expect(res.status).toBeLessThanOrEqual(429);
      }
      const blocked = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .send({ token: 'a.b.c' })
        .expect(429);
      expect(blocked.body).toMatchObject({
        error: { code: 'THROTTLED' },
      });
    } finally {
      await app.close();
    }
  });

  it('GET /api/discovery/info returns 429 after 60 requests within a minute', async () => {
    const app = await buildApp();
    try {
      for (let i = 0; i < 60; i++) {
        const res = await request(app.getHttpServer()).get('/api/discovery/info');
        expect(res.status).toBe(200);
      }
      const blocked = await request(app.getHttpServer())
        .get('/api/discovery/info')
        .expect(429);
      expect(blocked.body).toMatchObject({
        error: { code: 'THROTTLED' },
      });
    } finally {
      await app.close();
    }
  });
});
