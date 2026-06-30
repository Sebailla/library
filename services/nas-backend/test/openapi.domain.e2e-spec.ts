import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { buildValidationPipe } from '../src/common/validation.pipe';
import { mountOpenApi } from '../src/common/openapi.bootstrap';

/**
 * Triangulation tests for the business-domain controllers'
 * OpenAPI coverage (PR-N6, issue #90).
 *
 * ``openapi.decorators.e2e-spec.ts`` covers health + discovery;
 * this file exercises every other domain controller route group
 * the SDK client cares about: auth pair/refresh (DTOs),
 * libraries CRUD (body schemas + 401/403/404/409), and the
 * admin-only scan enqueue surface.
 *
 * Each assertion walks INTO the spec document instead of
 * relying on the UI surface — so a missing decorator
 * (``@ApiBody``, ``@ApiBearerAuth``, ``@ApiOperation``,
 * ``@ApiResponse``, etc.) breaks the test, not just the UI.
 */

interface OpenApiSpec {
  openapi: string;
  info: { title: string; version?: string };
  paths: Record<string, Record<string, unknown>>;
  components?: {
    securitySchemes?: Record<string, Record<string, unknown>>;
    schemas?: Record<string, Record<string, unknown>>;
  };
}

interface Operation {
  summary?: string;
  description?: string;
  operationId?: string;
  tags?: string[];
  security?: Array<Record<string, string[]>>;
  responses?: Record<string, { description?: string; content?: unknown }>;
  requestBody?: {
    content?: Record<string, { schema?: unknown; example?: unknown }>;
  };
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
  mountOpenApi(app);
  app.useGlobalPipes(buildValidationPipe());
  await app.init();
  return app;
}

async function fetchSpec(): Promise<OpenApiSpec> {
  const app = await buildApp();
  try {
    const res = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    return res.body as OpenApiSpec;
  } finally {
    await app.close();
  }
}

function getOp(spec: OpenApiSpec, path: string, method: string): Operation {
  const op = spec.paths[path]?.[method] as Operation | undefined;
  if (!op) {
    throw new Error(`Missing operation ${method.toUpperCase()} ${path} in spec`);
  }
  return op;
}

describe('OpenAPI decorator coverage: auth (PR-N6)', () => {
  it('POST /api/auth/pair documents the pair body and a 201 response', async () => {
    const spec = await fetchSpec();
    const op = getOp(spec, '/api/auth/pair', 'post');
    expect(op.tags).toContain('auth');
    expect(op.tags).toContain('auth');
    expect(typeof op.summary).toBe('string');
    expect(op.summary?.length).toBeGreaterThan(0);
    expect(op.requestBody?.content?.['application/json']).toBeDefined();
    expect(op.responses?.['201']).toBeDefined();
    expect(op.responses?.['422']).toBeDefined();
  });

  it('POST /api/auth/refresh documents the refresh body, a 201 and 401 responses', async () => {
    const spec = await fetchSpec();
    const op = getOp(spec, '/api/auth/refresh', 'post');
    expect(op.tags).toContain('auth');
    expect(op.requestBody?.content?.['application/json']).toBeDefined();
    expect(op.responses?.['201']).toBeDefined();
    expect(op.responses?.['401']).toBeDefined();
  });
});

describe('OpenAPI decorator coverage: libraries (PR-N6)', () => {
  it('GET /api/libraries declares a 200 + 401 response pair', async () => {
    const spec = await fetchSpec();
    const op = getOp(spec, '/api/libraries', 'get');
    expect(op.tags).toContain('libraries');
    expect(op.responses?.['200']).toBeDefined();
    expect(op.responses?.['401']).toBeDefined();
  });

  it('POST /api/libraries declares a body, a 201 + 401 + 422 trio', async () => {
    const spec = await fetchSpec();
    const op = getOp(spec, '/api/libraries', 'post');
    expect(op.tags).toContain('libraries');
    expect(op.requestBody?.content?.['application/json']).toBeDefined();
    expect(op.responses?.['201']).toBeDefined();
    expect(op.responses?.['401']).toBeDefined();
    expect(op.responses?.['422']).toBeDefined();
  });

  it('DELETE /api/libraries/{id} declares the full 204 + 401 + 403 + 404 + 409 lifecycle', async () => {
    const spec = await fetchSpec();
    const op = getOp(spec, '/api/libraries/{id}', 'delete');
    expect(op.tags).toContain('libraries');
    expect(op.responses?.['204']).toBeDefined();
    expect(op.responses?.['401']).toBeDefined();
    expect(op.responses?.['403']).toBeDefined();
    expect(op.responses?.['404']).toBeDefined();
    // ``CONFLICT`` (409) is specifically the
    // ``LIBRARY_NOT_EMPTY`` envelope the service throws when
    // the library still holds indexed books. PR-N6 must keep
    // that documented.
    expect(op.responses?.['409']).toBeDefined();
  });

  it('PUT /api/libraries/{id}/active declares 200 + 401 + 404', async () => {
    const spec = await fetchSpec();
    const op = getOp(spec, '/api/libraries/{id}/active', 'put');
    expect(op.tags).toContain('libraries');
    expect(op.responses?.['200']).toBeDefined();
    expect(op.responses?.['401']).toBeDefined();
    expect(op.responses?.['404']).toBeDefined();
  });
});

describe('OpenAPI decorator coverage: admin scan (PR-N6)', () => {
  it('POST /api/admin/scan/incremental documents an integer-typed body', async () => {
    const spec = await fetchSpec();
    const op = getOp(spec, '/api/admin/scan/incremental', 'post');
    expect(op.tags).toContain('admin');
    expect(op.requestBody?.content?.['application/json']).toBeDefined();
    expect(op.responses?.['202']).toBeDefined();
    expect(op.responses?.['422']).toBeDefined();
  });

  it('GET /api/admin/scan/status/{job_id} documents the 200 + 404 pair', async () => {
    const spec = await fetchSpec();
    const op = getOp(spec, '/api/admin/scan/status/{job_id}', 'get');
    expect(op.tags).toContain('admin');
    expect(op.responses?.['200']).toBeDefined();
    expect(op.responses?.['404']).toBeDefined();
  });

  it('every documented admin route requires the bearer scheme', async () => {
    const spec = await fetchSpec();
    // Walk the four write/read paths under /api/admin/scan/* and
    // assert each one asks for the bearer security scheme. The SDK
    // generator uses this to know it must attach a token.
    const adminOps: Array<[string, string]> = [
      ['/api/admin/scan/full', 'post'],
      ['/api/admin/scan/incremental', 'post'],
      ['/api/admin/scan/status', 'get'],
      ['/api/admin/scan/status/{job_id}', 'get'],
      ['/api/admin/scan/cancel/{job_id}', 'post'],
    ];
    for (const [path, method] of adminOps) {
      const op = getOp(spec, path, method);
      expect(Array.isArray(op.security)).toBe(true);
      expect(op.security?.length).toBeGreaterThan(0);
      expect(Object.keys(op.security?.[0] ?? {})).toContain('bearer');
    }
  });
});
