import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MeController } from './me.controller';

/**
 * ``GET /api/me`` is the sample protected route wired up to
 * demonstrate the ``JwtAuthGuard``. The module is intentionally
 * trivial: it only re-exports ``AuthModule``'s guard and exposes
 * ``MeController``. Future profile endpoints land here too.
 */
@Module({
  imports: [AuthModule],
  controllers: [MeController],
})
export class MeModule {}
