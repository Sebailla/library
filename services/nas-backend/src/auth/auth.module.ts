import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import {
  DEVICES_REPOSITORY,
  DevicesRepository,
  PgDevicesRepository,
} from './devices.repository';
import { DatabaseModule } from '../database/database.module';
import { PG_POOL } from '../database/pg.service';
import { Pool } from 'pg';

/**
 * Auth module — PIN pairing, JWT issuance, device persistence.
 *
 * Wires:
 *
 *   POST /api/auth/pair    → AuthController.pair    → AuthService.pair
 *   POST /api/auth/refresh → AuthController.refresh → AuthService.refresh
 *
 * ``DevicesRepository`` is exposed via the ``DEVICES_REPOSITORY``
 * string token so e2e tests can override it with an in-memory
 * implementation. Production wiring binds it to
 * ``PgDevicesRepository`` backed by the shared ``pg.Pool`` from
 * ``DatabaseModule``.
 */
@Module({
  imports: [
    DatabaseModule,
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: process.env.NAS_JWT_SECRET ?? 'dev-secret-change-me',
        signOptions: { algorithm: 'HS256' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    {
      provide: DEVICES_REPOSITORY,
      inject: [PG_POOL],
      useFactory: (pool: Pool): DevicesRepository =>
        new PgDevicesRepository(pool),
    },
  ],
  exports: [AuthService, DEVICES_REPOSITORY],
})
export class AuthModule {}
