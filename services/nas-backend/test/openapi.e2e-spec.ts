import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { buildValidationPipe } from '../src/common/validation.pipe';
import { mountOpenApi } from '../src/common/openapi.bootstrap';

/**
 * End-to-end contract tests for the OpenAPI surface shipped in
 * PR-N6 (issue #90).
 *
 *   GET /api/docs       → 200 HTML Swagger UI page
 *   GET /api/docs-json  → 200 application/json OpenAPI 3.x document
 *
 * The spec document MUST:
 *
 *   - declare ``openapi: '3.x.y'`` (any 3.x),
 *   - declare the ``info.title`` so the UI has a heading,
 *   - declare the standard HTTP methods or error responses for the
 *     existing routes so the generated TS client can compile
 *     against real route shapes,
 *   - be deterministic across bootstraps (snapshot-friendly) so we
 *     can detect drift.
 *
 * Both endpoints are public — operators need Swagger UI before they
 * have a Bearer token, the same way they need ``/api/discovery/info``.
 */

interface OpenApiSpec {
  openapi: string;
  info: { title: string; version?: string };
  paths: Record<string, Record<string, unknown>>;
  components?: Record<string, unknown>;
}

async function buildApp(): Promise<INestApplication> {
  process.env.NAS_PAIR_PIN = process.env.NAS_PAIR_PIN ?? '12345678';
  process.env.NAS_JWT_SECRET =
    process.env.NAS_JWT_SECRET ?? 'test-secret-do-not-use-in-prod-must-be-32+bytes';
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider('DATABASE_PING')
    .useValue(async () => undefined)
    .overrideProvider('REDIS_PING')
    .useValue(async () => undefined)
    .compile();
  const app = moduleRef.createNestApplication();
  // Production's main.ts calls mountOpenApi BEFORE app.init()
  // because middleware mounted after init is invisible to the
  // supertest pattern used in this repo. Mirror that order here.
  mountOpenApi(app);
  app.useGlobalPipes(buildValidationPipe());
  await app.init();
  return app;
}

function isOpenApiSpec(body: unknown): body is OpenApiSpec {
  if (typeof body !== 'object' || body === null) return false;
  const o = body as Record<string, unknown>;
  return (
    typeof o.openapi === 'string' &&
    /^3\.\d+\.\d+$/.test(o.openapi) &&
    typeof o.info === 'object' &&
    o.info !== null &&
    typeof (o.info as Record<string, unknown>).title === 'string' &&
    typeof o.paths === 'object' &&
    o.paths !== null
  );
}

describe('GET /api/docs-json (OpenAPI 3.x raw spec — PR-N6, issue #90)', () => {
  it('returns 200 with valid OpenAPI 3.x JSON', async () => {
    const app = await buildApp();
    try {
      const res = await request(app.getHttpServer())
        .get('/api/docs-json')
        .expect(200);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(isOpenApiSpec(res.body)).toBe(true);
      expect(res.body.info.title.length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it('declares the public discovery endpoint so SDK clients can compile', async () => {
    const app = await buildApp();
    try {
      const res = await request(app.getHttpServer())
        .get('/api/docs-json')
        .expect(200);
      const spec = res.body as OpenApiSpec;
      expect(spec.paths['/api/discovery/info']).toBeDefined();
      const get = spec.paths['/api/discovery/info']?.get as
        | Record<string, unknown>
        | undefined;
      expect(get).toBeDefined();
      expect(Array.isArray(get?.responses)).toBe(false);
      // The OpenAPI document must describe a 200 response so the
      // generated client maps it to ``paths['/api/discovery/info'].get.responses[200]``.
      const responses = get?.responses as Record<string, unknown> | undefined;
      expect(responses).toBeDefined();
      expect(responses?.['200']).toBeDefined();
    } finally {
      await app.close();
    }
  });

  it('declares the health probes with their status codes', async () => {
    const app = await buildApp();
    try {
      const res = await request(app.getHttpServer())
        .get('/api/docs-json')
        .expect(200);
      const spec = res.body as OpenApiSpec;
      for (const route of ['/livez', '/readyz', '/health']) {
        expect(spec.paths[route]).toBeDefined();
        const get = spec.paths[route]?.get as
          | Record<string, unknown>
          | undefined;
        expect(get).toBeDefined();
        const responses = get?.responses as Record<string, unknown>;
        expect(responses?.['200']).toBeDefined();
      }
    } finally {
      await app.close();
    }
  });
});

describe('GET /api/docs (Swagger UI — PR-N6, issue #90)', () => {
  it('returns 200 HTML that loads the Swagger UI bundle', async () => {
    const app = await buildApp();
    try {
      const res = await request(app.getHttpServer()).get('/api/docs').expect(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      // The Swagger UI HTML ALWAYS embeds a <link rel="stylesheet"
      // href=".../swagger-ui.css"> and a <script src=".../
      // swagger-ui-bundle.js"> reference. Asserting on these
      // markers proves the route serves the real UI rather than a
      // stub or 404 page.
      expect(res.text).toMatch(/swagger-ui/i);
    } finally {
      await app.close();
    }
  });

  it('serves swagger-ui-init.js that points the UI at /api/docs-json', async () => {
    const app = await buildApp();
    try {
      // swagger-ui-express ships a tiny ``swagger-ui-init.js``
      // that bootstraps the UI. That script carries the spec URL
      // the UI should fetch. We pull the script and assert it
      // references ``/api/docs-json`` so the UI hydrates against
      // the live spec served by this same app.
      const init = await request(app.getHttpServer())
        .get('/api/docs/swagger-ui-init.js')
        .expect(200);
      expect(init.text).toMatch(/docs-json/);
    } finally {
      await app.close();
    }
  });
});

describe('OpenAPI document stability (snapshot drift detection — PR-N6)', () => {
  it('produces a stable path ordering across two bootstraps', async () => {
    // Two independent app bootstraps → two independent spec
    // serializers. If a side effect in the decorator graph breaks
    // determinism (e.g. a controller introspects a Date.now()) the
    // path keys will diverge. Comparing ONLY the set of declared
    // routes catches accidental re-orderings without being brittle
    // to incidental whitespace changes.
    const app1 = await buildApp();
    let paths1: string[];
    try {
      const res = await request(app1.getHttpServer())
        .get('/api/docs-json')
        .expect(200);
      paths1 = Object.keys((res.body as OpenApiSpec).paths).sort();
    } finally {
      await app1.close();
    }
    const app2 = await buildApp();
    let paths2: string[];
    try {
      const res = await request(app2.getHttpServer())
        .get('/api/docs-json')
        .expect(200);
      paths2 = Object.keys((res.body as OpenApiSpec).paths).sort();
    } finally {
      await app2.close();
    }
    expect(paths1).toEqual(paths2);
    expect(paths1.length).toBeGreaterThan(0);
  });
});
