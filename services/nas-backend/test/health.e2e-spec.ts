import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * End-to-end tests for the k8s probe endpoints (4R review #38).
 *
 * ``GET /health`` is split into:
 *
 *   - ``GET /livez``  — liveness probe. Returns 200 whenever the
 *     process is up and HTTP is responsive. NEVER touches a
 *     dependency. Used by k8s to decide whether to RESTART the
 *     pod (we never want a transient Redis blip to restart us).
 *
 *   - ``GET /readyz`` — readiness probe. Returns 503 when the
 *     primary dependency (Postgres) is unreachable. Redis-down
 *     stays 200 because the API layer (auth, books, search,
 *     downloads HTTP) is fully functional on Postgres alone —
 *     only the BullMQ workers require Redis, and they self-
 *     disable when the broker is unreachable.
 *
 *   - ``GET /health`` — kept as a verbose diagnostic (mirrors the
 *     pre-PR behaviour) that checks BOTH dependencies and reports
 *     per-check status. Operators still rely on it for the
 *     "what's actually down" answer.
 *
 * Both ping providers are overridden in every test so the suite
 * does not need real Postgres + Redis instances to run.
 */
describe('GET /livez (liveness probe)', () => {
  const okPing = async (): Promise<void> => undefined;
  const failingPing = async (): Promise<void> => {
    throw new Error('simulated outage');
  };

  async function buildApp(
    dbOverride: () => Promise<void> = okPing,
    redisOverride: () => Promise<void> = okPing,
  ): Promise<INestApplication> {
    process.env.NAS_PAIR_PIN = process.env.NAS_PAIR_PIN ?? '12345678';
    process.env.NAS_JWT_SECRET =
      process.env.NAS_JWT_SECRET ?? 'test-secret-do-not-use-in-prod-must-be-32+bytes';
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider('DATABASE_PING')
      .useValue(dbOverride)
      .overrideProvider('REDIS_PING')
      .useValue(redisOverride)
      .compile();
    const testApp = moduleRef.createNestApplication();
    await testApp.init();
    return testApp;
  }

  it('returns 200 when DB + Redis are healthy', async () => {
    const app = await buildApp();
    try {
      const res = await request(app.getHttpServer()).get('/livez').expect(200);
      expect(res.body).toMatchObject({ status: 'ok' });
    } finally {
      await app.close();
    }
  });

  it('returns 200 even when Postgres is unreachable (liveness ignores deps)', async () => {
    const app = await buildApp(failingPing);
    try {
      const res = await request(app.getHttpServer()).get('/livez').expect(200);
      expect(res.body).toMatchObject({ status: 'ok' });
    } finally {
      await app.close();
    }
  });

  it('returns 200 even when Redis is unreachable (liveness ignores deps)', async () => {
    const app = await buildApp(okPing, failingPing);
    try {
      const res = await request(app.getHttpServer()).get('/livez').expect(200);
      expect(res.body).toMatchObject({ status: 'ok' });
    } finally {
      await app.close();
    }
  });
});

describe('GET /readyz (readiness probe)', () => {
  const okPing = async (): Promise<void> => undefined;
  const failingPing = async (): Promise<void> => {
    throw new Error('simulated outage');
  };

  async function buildApp(
    dbOverride: () => Promise<void> = okPing,
    redisOverride: () => Promise<void> = okPing,
  ): Promise<INestApplication> {
    process.env.NAS_PAIR_PIN = process.env.NAS_PAIR_PIN ?? '12345678';
    process.env.NAS_JWT_SECRET =
      process.env.NAS_JWT_SECRET ?? 'test-secret-do-not-use-in-prod-must-be-32+bytes';
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider('DATABASE_PING')
      .useValue(dbOverride)
      .overrideProvider('REDIS_PING')
      .useValue(redisOverride)
      .compile();
    const testApp = moduleRef.createNestApplication();
    await testApp.init();
    return testApp;
  }

  it('returns 200 when Postgres is reachable (Redis is irrelevant for readiness)', async () => {
    const app = await buildApp(okPing, failingPing);
    try {
      const res = await request(app.getHttpServer()).get('/readyz').expect(200);
      expect(res.body).toMatchObject({ status: 'ok' });
    } finally {
      await app.close();
    }
  });

  it('returns 503 when Postgres is unreachable', async () => {
    const app = await buildApp(failingPing, okPing);
    try {
      const res = await request(app.getHttpServer()).get('/readyz').expect(503);
      expect(res.body).toMatchObject({ status: 'error' });
      expect(res.body.checks.db).toMatchObject({ ok: false });
    } finally {
      await app.close();
    }
  });

  it('returns 503 when both Postgres and Redis are unreachable', async () => {
    const app = await buildApp(failingPing, failingPing);
    try {
      const res = await request(app.getHttpServer()).get('/readyz').expect(503);
      expect(res.body).toMatchObject({ status: 'error' });
      expect(res.body.checks.db).toMatchObject({ ok: false });
    } finally {
      await app.close();
    }
  });
});

describe('GET /health (verbose diagnostic, still checks both deps)', () => {
  const okPing = async (): Promise<void> => undefined;
  const failingPing = async (): Promise<void> => {
    throw new Error('simulated outage');
  };

  async function buildApp(
    dbOverride: () => Promise<void> = okPing,
    redisOverride: () => Promise<void> = okPing,
  ): Promise<INestApplication> {
    process.env.NAS_PAIR_PIN = process.env.NAS_PAIR_PIN ?? '12345678';
    process.env.NAS_JWT_SECRET =
      process.env.NAS_JWT_SECRET ?? 'test-secret-do-not-use-in-prod-must-be-32+bytes';
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider('DATABASE_PING')
      .useValue(dbOverride)
      .overrideProvider('REDIS_PING')
      .useValue(redisOverride)
      .compile();
    const testApp = moduleRef.createNestApplication();
    await testApp.init();
    return testApp;
  }

  it('returns 200 when DB + Redis are healthy', async () => {
    const app = await buildApp();
    try {
      const res = await request(app.getHttpServer()).get('/health').expect(200);
      expect(res.body).toMatchObject({
        status: 'ok',
        version: expect.any(String),
      });
      expect(typeof res.body.timestamp).toBe('string');
      expect(() => new Date(res.body.timestamp).toISOString()).not.toThrow();
    } finally {
      await app.close();
    }
  });

  it('returns 503 when Postgres is unreachable', async () => {
    const app = await buildApp(failingPing);
    try {
      const res = await request(app.getHttpServer()).get('/health').expect(503);
      expect(res.body).toMatchObject({
        status: 'error',
        version: expect.any(String),
      });
      expect(res.body.checks.db).toMatchObject({ ok: false });
      expect(res.body.checks.redis).toMatchObject({ ok: true });
    } finally {
      await app.close();
    }
  });

  it('returns 503 when Redis is unreachable', async () => {
    const app = await buildApp(okPing, failingPing);
    try {
      const res = await request(app.getHttpServer()).get('/health').expect(503);
      expect(res.body).toMatchObject({
        status: 'error',
        version: expect.any(String),
      });
      expect(res.body.checks.redis).toMatchObject({ ok: false });
      expect(res.body.checks.db).toMatchObject({ ok: true });
    } finally {
      await app.close();
    }
  });
});
