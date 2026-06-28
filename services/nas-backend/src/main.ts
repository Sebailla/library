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

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  // 4R review #41 — global ValidationPipe with the project envelope.
  app.useGlobalPipes(buildValidationPipe());

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);

  Logger.log(`alejandria-nas-backend listening on :${port}`, 'Bootstrap');
}

bootstrap().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('Fatal bootstrap error', err);
  process.exit(1);
});
