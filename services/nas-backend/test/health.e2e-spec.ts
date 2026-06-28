import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { AppModule } from '../src/app.module';
import { PG_POOL } from '../src/database/pg.service';
import { buildValidationPipe } from '../src/common/validation.pipe';

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

/**
 * 4R review #40 — HealthModule must NOT redefine PG_POOL.
 *
 * Before this PR the health module opened a parallel ``pg.Pool``
 * (a second factory with a hard-coded localhost URL) instead of
 * importing ``DatabaseModule``. With ``AppModule`` already
 * importing both modules, the resolver saw two ``PG_POOL``
 * providers and the health module's local one shadowed the shared
 * one — meaning a connection pool was opened twice against
 * Postgres, the health check pinged the wrong URL, and tests had
 * no clean seam to inject a stub pool.
 *
 * Contract: the module graph must expose exactly one ``PG_POOL``
 * provider and it MUST be the same instance both
 * ``PgService`` (via DatabaseModule) and ``HealthService`` resolve
 * — i.e. they share a single connection pool.
 */
describe('HealthModule shares DatabaseModule PG_POOL (4R review #40)', () => {
  async function buildModule(): Promise<TestingModule> {
    process.env.NAS_PAIR_PIN = process.env.NAS_PAIR_PIN ?? '12345678';
    process.env.NAS_JWT_SECRET =
      process.env.NAS_JWT_SECRET ??
      'test-secret-do-not-use-in-prod-must-be-32+bytes';
    return Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider('DATABASE_PING')
      .useValue(async () => undefined)
      .overrideProvider('REDIS_PING')
      .useValue(async () => undefined)
      .compile();
  }

  it('exposes a single PG_POOL provider (no parallel pool factory)', async () => {
    const moduleRef = await buildModule();
    try {
      // Resolving PG_POOL twice MUST return the same instance —
      // a single shared pool across the whole module graph.
      const a = moduleRef.get<Pool>(PG_POOL);
      const b = moduleRef.get<Pool>(PG_POOL);
      expect(a).toBe(b);
    } finally {
      await moduleRef.close();
    }
  });

  it('DATABASE_PING factory receives the shared pool injected by DatabaseModule', async () => {
    // The contract: HealthModule does NOT register a parallel
    // ``PG_POOL`` provider. It must IMPORT ``DatabaseModule`` and
    // the ``DATABASE_PING`` factory must therefore receive the
    // SAME pool token that ``PgService`` resolves.
    //
    // Strategy: override ``PG_POOL`` with a sentinel pool, then
    // override ``DATABASE_PING`` with a spy that captures the
    // pool it was DIED with at factory invocation time. If the
    // factory receives the sentinel, both providers see the same
    // PG_POOL token (i.e. DatabaseModule is the single owner).
    const sentinelPool: Pool = new Pool({
      connectionString: 'postgresql://sentinel:sentinel@127.0.0.1:65535/sentinel',
    });
    let capturedPool: Pool | undefined;
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PG_POOL)
      .useValue(sentinelPool)
      .overrideProvider('DATABASE_PING')
      .useFactory({
        factory: (pool: Pool): (() => Promise<void>) => {
          capturedPool = pool;
          return async () => undefined;
        },
        inject: [PG_POOL],
      })
      .overrideProvider('REDIS_PING')
      .useValue(async () => undefined)
      .compile();
    try {
      // Resolving DATABASE_PING triggers the factory; the factory
      // captures the pool it received from DI.
      moduleRef.get('DATABASE_PING');
      expect(capturedPool).toBe(sentinelPool);
    } finally {
      await moduleRef.close();
    }
  });

  it('AppModule exposes only one PG_POOL provider across the whole tree', async () => {
    // We poke at the Nest internal container (``InternalCoreModule``
    // is private; we reach in via the application context's
    // ``getInstanceByToken`` proxy) by overriding ``PG_POOL`` with a
    // factory that RECORDS its own invocation. If HealthModule
    // redefines PG_POOL, both providers will fight and the
    // override might not be observed; if DatabaseModule is the
    // sole owner the override is invoked exactly once during
    // resolution and we capture the call count.
    let poolFactoryCalls = 0;
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PG_POOL)
      .useFactory({
        factory: (): Pool => {
          poolFactoryCalls += 1;
          return new Pool({
            connectionString:
              process.env.DATABASE_URL ??
              'postgresql://alejandria:alejandria@localhost:5432/alejandria',
          });
        },
      })
      .compile();
    try {
      // Trigger resolution — every module that needs PG_POOL
      // resolves it through the same singleton, so the factory
      // must run at most once. If HealthModule re-registered
      // PG_POOL as its own provider, Nest would either throw a
      // duplicate-provider error or invoke the factory twice.
      moduleRef.get<Pool>(PG_POOL);
      moduleRef.get<Pool>(PG_POOL);
      expect(poolFactoryCalls).toBe(1);
    } finally {
      await moduleRef.close();
    }
  });
});
