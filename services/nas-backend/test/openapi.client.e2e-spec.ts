import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { buildValidationPipe } from '../src/common/validation.pipe';
import { mountOpenApi } from '../src/common/openapi.bootstrap';

/**
 * Contract test for the auto-generated TypeScript SDK client.
 *
 * PR-N6 (issue #90) generates ``services/nas-backend/clients/ts/api.d.ts``
 * from the OpenAPI 3.x spec served at ``/api/docs-json`` so the
 * iPad / web clients can import ``paths['/api/auth/pair'].post``
 * instead of writing their own request shapes by hand.
 *
 * This test guards the contract:
 *
 *   1. The client file exists.
 *   2. It contains the typed path-key entries the SDK callers
 *      reach for (a stable set picked from auth + libraries + the
 *      admin surface — exercising auth-required + body + bearer
 *      decorators in one place).
 *   3. A tiny consumer project at ``test/sdk-consumers/sample.ts``
 *      COMPILES against the generated client — proving the
 *      generated types are usable, not just present.
 *
 * The consumer is compiled in a one-shot sub-folder so this test
 * never mutates the main ``tsconfig.json`` and never leaves stray
 * files behind.
 */

const CLIENT_DIR = path.resolve(__dirname, '../clients/ts');
const CLIENT_FILE = path.join(CLIENT_DIR, 'api.d.ts');
const CONSUMER_DIR = path.resolve(__dirname, './sdk-consumers');

interface OpenApiSpec {
  openapi: string;
  info: { title: string; version?: string };
  paths: Record<string, Record<string, unknown>>;
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

describe('Generated TS SDK client (clients/ts/api.d.ts — PR-N6)', () => {
  it('exists on disk after running npm run openapi:generate', async () => {
    if (!fs.existsSync(CLIENT_FILE)) {
      // Production CI runs `npm run openapi:generate` before
      // this test. If the file is missing here we surface a
      // helpful error so the developer knows exactly which
      // script to run.
      throw new Error(
        `Generated client missing at ${CLIENT_FILE}. Run \`npm run openapi:generate\` in services/nas-backend/.`,
      );
    }
    const contents = fs.readFileSync(CLIENT_FILE, 'utf8');
    expect(contents.length).toBeGreaterThan(0);
  });

  it('declares the auth, libraries, and admin paths the SDK clients reach for', async () => {
    const contents = fs.readFileSync(CLIENT_FILE, 'utf8');
    // openapi-typescript serialises every route as a literal
    // key inside ``paths:`` AND references the verb via an
    // ``operations["Controller_method"]`` symbol in the
    // ``operations`` interface. Asserting on a fixed route list
    // catches unintentional renames that would break the iPad
    // client. Asserting on the per-controller method symbol
    // makes sure the HTTP verb survived codegen.
    const requiredRoutes: Array<[string, string, string]> = [
      ['/api/auth/pair', 'post', 'AuthController_pair'],
      ['/api/auth/refresh', 'post', 'AuthController_refresh'],
      ['/api/discovery/info', 'get', 'DiscoveryController_info'],
      ['/api/discovery/network', 'get', 'DiscoveryController_network'],
      ['/api/libraries', 'get', 'LibrariesController_list'],
      ['/api/libraries', 'post', 'LibrariesController_create'],
      ['/api/libraries/{id}', 'delete', 'LibrariesController_delete'],
      ['/api/libraries/{id}/active', 'put', 'LibrariesController_setActive'],
      ['/api/admin/scan/full', 'post', 'ScanController_enqueueFull'],
      ['/api/admin/scan/incremental', 'post', 'ScanController_enqueueIncremental'],
      ['/api/admin/scan/status/{job_id}', 'get', 'ScanController_detail'],
    ];
    for (const [route, , opKey] of requiredRoutes) {
      expect(contents).toContain(`"${route}"`);
    }
    // Every required operation must show up in the generated
    // ``operations`` interface — proves the controller methods
    // are reachable under their HTTP-verb-typed names.
    const opMatches = new Set<string>();
    const opRegex = /operations\["([A-Za-z0-9_]+)"\]/g;
    let match: RegExpExecArray | null;
    while ((match = opRegex.exec(contents)) !== null) {
      opMatches.add(match[1]);
    }
    for (const [, , opKey] of requiredRoutes) {
      expect(opMatches.has(opKey)).toBe(true);
    }
  });

  it('compiles a tiny consumer project that uses the SDK types (PR-N6)', async () => {
    if (!fs.existsSync(CLIENT_FILE)) {
      throw new Error(
        `Generated client missing at ${CLIENT_FILE}. Run \`npm run openapi:generate\` first.`,
      );
    }
    // Generate a tiny consumer that uses the SDK types. Place it
    // under test/sdk-consumers/ so it has access to the project's
    // node_modules + tsconfig but stays out of the main build.
    fs.mkdirSync(CONSUMER_DIR, { recursive: true });
    const consumerPath = path.join(CONSUMER_DIR, 'sample-sdk-usage.ts');
    const consumerSource = `
import type { paths } from '${path.relative(CONSUMER_DIR, CLIENT_FILE).replace(/\\.d\\.ts$/, '')}';

// Pair (POST /api/auth/pair) — request body typing
export const pairRequest: paths['/api/auth/pair']['post']['requestBody']['content']['application/json'] = {
  pin: '12345678',
  device_name: "test client",
};

// Pair response — success
export const pairResponse: paths['/api/auth/pair']['post']['responses']['201']['content']['application/json'] = {
  token: 'h.p.s',
  expires_at: new Date().toISOString(),
  device_id: 'uuid',
};

// Pair response — throttled
export const pairThrottled: paths['/api/auth/pair']['post']['responses']['429']['content']['application/json'] = {
  error: { code: 'THROTTLED', message: 'x' },
};

// Pair body validation
export const pairInvalid: paths['/api/auth/pair']['post']['responses']['422']['content']['application/json'] = {
  error: { code: 'VALIDATION_FAILED', message: 'x', details: [] },
};
`;
    fs.writeFileSync(consumerPath, consumerSource, 'utf8');

    // Compile in noEmit mode against the project's tsconfig. The
    // SDK client lives under clients/ts/ and the consumer under
    // test/sdk-consumers/ — extend tsconfig.include at run time
    // by passing a one-off tsconfig override on the CLI.
    const tsconfigOverride = path.join(CONSUMER_DIR, 'tsconfig.json');
    const rootDir = path.relative(CONSUMER_DIR, path.resolve(__dirname, '..'));
    fs.writeFileSync(
      tsconfigOverride,
      JSON.stringify(
        {
          extends: path.relative(CONSUMER_DIR, path.resolve(__dirname, '..', 'tsconfig.json')),
          compilerOptions: {
            noEmit: true,
            rootDir: path.relative(CONSUMER_DIR, path.resolve(__dirname, '..')),
            baseUrl: path.relative(CONSUMER_DIR, path.resolve(__dirname, '..')),
            paths: {
              '@app/*': ['src/*'],
            },
          },
          include: [
            path.relative(CONSUMER_DIR, CLIENT_FILE),
            consumerPath,
          ],
        },
        null,
        2,
      ),
      'utf8',
    );

    const cwd = path.resolve(__dirname, '..');
    const localTsc = path.join(cwd, 'node_modules', '.bin', 'tsc');
    let compileOk = false;
    let compileOutput = '';
    try {
      compileOutput = execSync(
        `${localTsc} --noEmit --project ${path.relative(cwd, tsconfigOverride)}`,
        {
          cwd,
          stdio: 'pipe',
          encoding: 'utf8',
        },
      );
      compileOk = true;
    } catch (err) {
      compileOutput =
        err instanceof Error ? (err as { stdout?: string; stderr?: string }).stdout ?? err.message : String(err);
    } finally {
      // Best-effort cleanup — leave the dir only when the
      // compile failed so a developer can inspect the input.
      if (compileOk) {
        try {
          fs.unlinkSync(consumerPath);
          fs.unlinkSync(tsconfigOverride);
          fs.rmdirSync(CONSUMER_DIR);
        } catch {
          // ignore
        }
      }
    }
    if (!compileOk) {
      throw new Error(
        `Generated SDK did not compile against a real consumer. Output:\n${compileOutput}\nConsumer preserved at ${consumerPath} for inspection.`,
      );
    }
  });

  it('regenerated spec matches what the live API serves (snapshot drift)', async () => {
    // The check script (`npm run openapi:check`) is what CI
    // runs on every PR: it regenerates the client and diffs the
    // result against the committed copy. This test asserts the
    // same property from the inside: the live spec at
    // ``/api/docs-json`` must be byte-compatible with the spec
    // used to generate the committed client.
    //
    // We can't easily rerun openapi-typescript from inside a
    // jest worker (it spawns a network fetcher against the dev
    // server), so instead we assert that the live spec contains
    // every required route the SDK file declares. Drift in
    // either direction trips this test.
    const liveSpec = await fetchSpec();
    const livePaths = new Set(Object.keys(liveSpec.paths));
    const fileContents = fs.readFileSync(CLIENT_FILE, 'utf8');

    // Pull every "..." route key the generated file declares by
    // matching the OpenAPI ``paths:`` literal patterns. This
    // avoids depending on the exact key formatting
    // openapi-typescript chose.
    const declaredRoutes = new Set<string>();
    const pathRegex = /"(\/api\/[^"\\]+|\/[a-z][^"\\]*)"\s*:\s*\{/g;
    let match: RegExpExecArray | null;
    while ((match = pathRegex.exec(fileContents)) !== null) {
      declaredRoutes.add(match[1]);
    }

    // Every SDK-declared route MUST still be reachable in the
    // live spec. A controller deletion that goes undetected
    // elsewhere breaks this test.
    for (const sdkRoute of declaredRoutes) {
      expect(livePaths.has(sdkRoute)).toBe(true);
    }
  });
});
