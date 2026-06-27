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
 */
describe('GET /health', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 200 when DB + Redis are healthy', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      version: expect.any(String),
    });
    expect(typeof res.body.timestamp).toBe('string');
    // ISO-8601 sanity check on the timestamp.
    expect(() => new Date(res.body.timestamp).toISOString()).not.toThrow();
  });

  it('returns 503 when Postgres is unreachable', async () => {
    // The provider that fails the DB ping is wired by AppModule; we
    // override it here with a fake that throws to simulate a down DB.
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider('DATABASE_PING')
      .useValue(async () => {
        throw new Error('connection refused');
      })
      .compile();
    const failingApp = moduleRef.createNestApplication();
    await failingApp.init();

    const res = await request(failingApp.getHttpServer())
      .get('/health')
      .expect(503);

    expect(res.body).toMatchObject({
      status: 'error',
      version: expect.any(String),
    });
    expect(res.body.checks.db).toMatchObject({ ok: false });

    await failingApp.close();
  });

  it('returns 503 when Redis is unreachable', async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider('REDIS_PING')
      .useValue(async () => {
        throw new Error('redis unreachable');
      })
      .compile();
    const failingApp = moduleRef.createNestApplication();
    await failingApp.init();

    const res = await request(failingApp.getHttpServer())
      .get('/health')
      .expect(503);

    expect(res.body).toMatchObject({
      status: 'error',
      version: expect.any(String),
    });
    expect(res.body.checks.redis).toMatchObject({ ok: false });

    await failingApp.close();
  });
});
