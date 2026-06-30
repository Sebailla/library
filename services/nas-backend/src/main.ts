/**
 * NestJS application bootstrap for alejandria-v2 NAS backend.
 *
 * Wires a project-wide ValidationPipe (4R review #41) so every DTO
 * failure — whether on body, query, or params — surfaces the same
 * ``{ error: { code: 'VALIDATION_FAILED', message, details } }``
 * envelope the rest of the API uses. The factory is shared with the
 * test bootstraps in ``test/*.e2e-spec.ts`` so production and tests
 * agree on the wire format.
 *
 * PR-N7 (issue #92) — observability closure:
 *
 *   - The request middleware (id propagation + per-request log
 *     envelope + HTTP counter / duration) is mounted via
 *     ``app.use(...)`` BEFORE ``app.init()`` so it is the
 *     first thing Express sees — it observes every request,
 *     including 404 fall-throughs and pre-handler errors. The
 *     middleware uses a lazy accessor that resolves the
 *     ``MetricsService`` from the DI container on first use,
 *     so the init ordering does not matter.
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { buildValidationPipe } from './common/validation.pipe';
import {
  METRICS_SERVICE,
  MetricsService,
} from './observability/metrics.service';
import { buildRequestMiddleware } from './observability/request-middleware';
import { mountOpenApi } from './common/openapi.bootstrap';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  // PR-N6 (issue #90) — OpenAPI 3.x spec + Swagger UI at
  // /api/docs and /api/docs-json. Mounted BEFORE app.init()
  // because, in test mode, express middleware added after init is
  // not visible through app.getHttpServer() (the supertest pattern
  // used by every e2e suite in this repo). Mirroring the controller
  // registration lifecycle keeps production and tests consistent.
  mountOpenApi(app);

  // 4R review #41 — global ValidationPipe with the project envelope.
  app.useGlobalPipes(buildValidationPipe());

  // PR-N7 — observability middleware. The metrics accessor is
  // resolved lazily on the first inbound request so mounting
  // can happen BEFORE ``app.init()`` — that ordering
  // guarantees the middleware sits in front of EVERY request,
  // including the 404 fall-throughs that bypass controllers.
  const lazyMetrics = {
    recordHttpRequest: (...args: Parameters<MetricsService['recordHttpRequest']>): void => {
      const svc = app.get(MetricsService);
      svc.recordHttpRequest(...args);
    },
  };
  app.use(buildRequestMiddleware({ metrics: lazyMetrics }));

  await app.init();

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);

  // Avoid "unused locals": METRICS_SERVICE is the
  // contract used by other modules (Test.createTestingModule,
  // instrumentation hooks) and must resolve to the same
  // singleton exposed by ``app.get(MetricsService)``.
  void METRICS_SERVICE;

  Logger.log(`alejandria-nas-backend listening on :${port}`, 'Bootstrap');
}

bootstrap().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('Fatal bootstrap error', err);
  process.exit(1);
});
