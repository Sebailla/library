import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { buildValidationPipe } from '../src/common/validation.pipe';
import { mountOpenApi } from '../src/common/openapi.bootstrap';

/**
 * Triangulation tests for the {@code @Api*} decorator coverage
 * shipped in PR-N6 (issue #90).
 *
 * The bare endpoint tests in ``openapi.e2e-spec.ts`` assert the
 * mount surface; this file proves the decorator graph is REAL by
 * walking into the spec document and asserting the metadata that
 * survives serialization. If a controller forgets to add
 * ``@ApiOperation``, ``@ApiResponse`` / ``@ApiOkResponse``, or
 * ``@ApiBearerAuth``, the spec is silently thinner than the live
 * API — these tests catch that.
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

describe('OpenAPI decorator coverage: health probes (PR-N6)', () => {
  it('/livez declares a 200 OK response and an operation summary', async () => {
    const spec = await fetchSpec();
    const op = getOp(spec, '/livez', 'get');
    expect(typeof op.summary).toBe('string');
    expect(op.summary?.length).toBeGreaterThan(0);
    expect(op.responses?.['200']).toBeDefined();
  });

  it('/readyz declares both the 200 OK and the 503 degraded responses', async () => {
    const spec = await fetchSpec();
    const op = getOp(spec, '/readyz', 'get');
    expect(op.responses?.['200']).toBeDefined();
    expect(op.responses?.['503']).toBeDefined();
  });

  it('/health declares both the 200 OK and the 503 degraded responses', async () => {
    const spec = await fetchSpec();
    const op = getOp(spec, '/health', 'get');
    expect(op.responses?.['200']).toBeDefined();
    expect(op.responses?.['503']).toBeDefined();
  });
});

describe('OpenAPI decorator coverage: discovery (PR-N6)', () => {
  it('/api/discovery/info is public (no security requirement) and tags as discovery', async () => {
    const spec = await fetchSpec();
    const op = getOp(spec, '/api/discovery/info', 'get');
    expect(op.tags).toContain('discovery');
    // Per the OpenAPI 3.x spec a public operation either omits
    // ``security`` entirely OR declares ``security: []``. Both
    // forms mean "no authentication required". The generated TS
    // SDK can rely on the absence of a bearer scheme for this
    // route regardless of which form we serialise.
    expect(op.security ?? []).toEqual([]);
  });

  it('/api/discovery/network is bearer-protected', async () => {
    const spec = await fetchSpec();
    const op = getOp(spec, '/api/discovery/network', 'get');
    expect(op.tags).toContain('discovery');
    expect(Array.isArray(op.security)).toBe(true);
    expect(op.security?.length).toBeGreaterThan(0);
    // The bearer scheme must be declared in components so SDK
    // generators know what to attach.
    expect(spec.components?.securitySchemes?.bearer).toBeDefined();
  });

  it('declares a 401 response on the auth-required network route', async () => {
    const spec = await fetchSpec();
    const op = getOp(spec, '/api/discovery/network', 'get');
    expect(op.responses?.['401']).toBeDefined();
  });
});
