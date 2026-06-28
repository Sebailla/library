import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * End-to-end tests for ``GET /health``.
 *
 * The health endpoint is the first contract the NAS backend exposes —
 * it MUST report whether the app can talk to Postgres + Redis before
 * any other traffic is served. The contract is:
 *
 *   200 OK   { status: "ok", timestamp: <iso>, version: <pkg.version> }
 *   503 SU   { status: "error", timestamp, version, checks: { db, redis } }
 *
 * Per the spec, the 503 path includes per-check status so a failing
 * dependency is identifiable from the response alone.
 *
 * Both ping providers are overridden in every test so the suite does
 * not need real Postgres + Redis instances to run. Production wiring
 * is exercised by ``docker compose up`` and the README's curl snippet.
 */
describe('GET /health', () => {
  const okPing = async (): Promise<void> => undefined;
  const failingPing = async (): Promise<void> => {
    throw new Error('simulated outage');
  };

  async function buildApp(
    dbOverride: () => Promise<void> = okPing,
    redisOverride: () => Promise<void> = okPing,
  ): Promise<INestApplication> {
    // The auth module refuses to boot without these env vars (4R
    // review #32). The health test does not exercise auth, but the
    // module graph still has to compile.
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
      // ISO-8601 sanity check on the timestamp.
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
      // Redis still healthy in this scenario.
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
      // DB still healthy in this scenario.
      expect(res.body.checks.db).toMatchObject({ ok: true });
    } finally {
      await app.close();
    }
  });
});
