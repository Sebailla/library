/**
 * NestJS application bootstrap for alejandria-v2 NAS backend.
 *
 * The bootstrap is intentionally minimal at this stage — the health
 * module is the only feature wired in PR-2A. Subsequent modules
 * (auth, books, search, downloads, workers, discovery, database) are
 * added in chained PRs following the work-units defined in
 * ``openspec/changes/alejandria-v2/tasks.md`` Phase 2.
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);

  Logger.log(`alejandria-nas-backend listening on :${port}`, 'Bootstrap');
}

bootstrap().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('Fatal bootstrap error', err);
  process.exit(1);
});
