/**
 * NestJS application bootstrap for alejandria-v2 NAS backend.
 *
 * Wires a project-wide ValidationPipe (4R review #41) so every DTO
 * failure — whether on body, query, or params — surfaces the same
 * ``{ error: { code: 'VALIDATION_FAILED', message, details } }``
 * envelope the rest of the API uses. The factory is shared with the
 * test bootstraps in ``test/*.e2e-spec.ts`` so production and tests
 * agree on the wire format.
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { buildValidationPipe } from './common/validation.pipe';
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

  await app.init();

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);

  Logger.log(`alejandria-nas-backend listening on :${port}`, 'Bootstrap');
}

bootstrap().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('Fatal bootstrap error', err);
  process.exit(1);
});
