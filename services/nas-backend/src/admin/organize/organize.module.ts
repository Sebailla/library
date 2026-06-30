import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { AuthModule } from '../../auth/auth.module';
import { DatabaseModule } from '../../database/database.module';
import { PG_POOL } from '../../database/pg.service';
import {
  OrganizeService,
  FILE_MOVER,
} from './organize.service';
import {
  OrganizeRepository,
  ORGANIZE_REPOSITORY,
  PgOrganizeRepository,
} from './organize.repository';
import {
  OrganizeController,
  FsFileMover,
} from './organize.controller';

/**
 * Admin organize module — PR-N5.
 *
 * Wires:
 *   - ``OrganizeRepository``  — pg-backed CRUD over the
 *                               ``organize_plans`` +
 *                               ``organize_actions`` tables
 *                               (migration 017).
 *   - ``OrganizeService``     — analyze + execute orchestration.
 *                               Accepts pre-computed proposed
 *                               actions from the controller
 *                               (the walker is a controller-
 *                               level concern so the analyze
 *                               step can stay synchronous in
 *                               the unit suite).
 *   - ``OrganizeController``  — ``/api/admin/organize/*`` HTTP
 *                               surface (POST analyze + POST
 *                               execute + GET plans/:id).
 *   - ``FsFileMover``         — production file-mover bound to
 *                               ``FILE_MOVER``; tests override
 *                               the token with an in-memory
 *                               recorder.
 *
 * Auth: the controller re-uses ``AuthModule`` for the
 * ``JwtAuthGuard`` + ``ScanAdminGuard`` (admin paired device).
 */
@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [OrganizeController],
  providers: [
    OrganizeService,
    {
      provide: ORGANIZE_REPOSITORY,
      inject: [PG_POOL],
      useFactory: (pool: Pool): OrganizeRepository => new PgOrganizeRepository(pool),
    },
    {
      provide: FILE_MOVER,
      useClass: FsFileMover,
    },
  ],
  exports: [OrganizeService, ORGANIZE_REPOSITORY],
})
export class OrganizeModule {}
