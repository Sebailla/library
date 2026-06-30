import { INestApplication, Logger } from '@nestjs/common';
import {
  DocumentBuilder,
  SwaggerModule,
} from '@nestjs/swagger';

/**
 * OpenAPI / Swagger UI bootstrap for the NAS backend.
 *
 * PR-N6 (issue #90) exposes the API contract as machine-readable
 * OpenAPI so:
 *
 *   - operators get a Swagger UI (``/api/docs``) for human
 *     exploration of every endpoint, request body, and response
 *     envelope,
 *   - the iPad client (``apps/mac`` and ``apps/web``) can generate
 *     a typed TS SDK from ``/api/docs-json`` via
 *     ``openapi-typescript`` (committed under
 *     ``clients/ts/api.d.ts`` for compile-time imports), and
 *   - future internal services that hit the NAS API have a
 *     stable, versioned contract they can codegen against.
 *
 * The two endpoints MUST be reachable WITHOUT a Bearer token so
 * discoverability stays open (same reasoning as
 * ``GET /api/discovery/info`` — clients need the contract
 * before they can authenticate).
 */
const DOCS_PATH = 'api/docs';
const DOCS_JSON_PATH = 'api/docs-json';
const OPENAPI_VERSION = '1.0.0';

interface OpenApiOptions {
  /** Caller may override the published version (semver of the API surface). */
  version?: string;
}

/**
 * Mount Swagger UI at ``/api/docs`` and the raw OpenAPI 3.x JSON
 * document at ``/api/docs-json``.
 *
 * Walks every controller in the application graph via
 * {@link SwaggerModule.createDocument} so any future controller
 * whose methods are decorated with ``@ApiOperation`` /
 * ``@ApiResponse`` automatically appears in the spec without
 * further wiring here.
 */
export function mountOpenApi(
  app: INestApplication,
  options: OpenApiOptions = {},
): void {
  const logger = new Logger('OpenAPI');
  const builder = new DocumentBuilder()
    .setTitle('alejandria NAS backend')
    .setDescription(
      [
        'Authoritative HTTP contract for the alejandria-v2 NAS backend.',
        '',
        'Every endpoint documented here is part of the PR-N6 closure (issue #90).',
        'Auth: the `bearer` security scheme is required for every route EXCEPT',
        '`/livez`, `/readyz`, `/health`, `/api/discovery/info`, `/api/auth/pair`,',
        '`/api/auth/refresh`, `/api/docs`, and `/api/docs-json`.',
      ].join('\n'),
    )
    .setVersion(options.version ?? OPENAPI_VERSION)
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'Short-lived JWT issued by `POST /api/auth/pair` or `POST /api/auth/refresh`.',
      },
      'bearer',
    )
    .addTag('health', 'k8s probes + verbose diagnostic')
    .addTag('discovery', 'pre-auth discovery (mDNS, Tailscale, LAN)')
    .addTag('auth', 'pair + refresh')
    .addTag('me', 'paired-device self-views')
    .addTag('libraries', 'multi-library registry')
    .addTag('books', 'catalog read endpoints')
    .addTag('authors', 'author index')
    .addTag('search', 'pgroonga-backed full-text search')
    .addTag('downloads', 'client download tracking')
    .addTag('files', 'authenticated file streaming + Range support')
    .addTag('admin', 'admin-only scan + organize');

  const document = SwaggerModule.createDocument(app, builder.build());
  SwaggerModule.setup(DOCS_PATH, app, document, {
    jsonDocumentUrl: DOCS_JSON_PATH,
    swaggerOptions: {
      persistAuthorization: true,
      // Keep the default expansion (everything visible) so operators
      // landing on the page see the full surface.
    },
  });
  logger.log(
    `OpenAPI UI mounted at /${DOCS_PATH} and JSON spec at /${DOCS_JSON_PATH}`,
  );
}

/** Paths mounted by {@link mountOpenApi}; exported for tests + the bootstraps. */
export const openApiPaths = {
  docs: DOCS_PATH,
  json: DOCS_JSON_PATH,
} as const;
