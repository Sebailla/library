import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtStrategy } from './jwt.strategy';
import {
  DEVICES_REPOSITORY,
  DevicesRepository,
  PgDevicesRepository,
} from './devices.repository';
import { DatabaseModule } from '../database/database.module';
import { PG_POOL } from '../database/pg.service';
import { Pool } from 'pg';

/**
 * Resolve and validate the HMAC secret used to sign issued JWTs.
 *
 * Boot-time security guard (#32, 4R review): the module MUST
 * refuse to start when ``NAS_JWT_SECRET`` is unset or shorter
 * than 32 bytes (256 bits — the HS256 security floor). Falling
 * back to a public literal like ``"dev-secret-change-me"`` would
 * let any attacker who has read the source forge a valid bearer
 * token, which is the exact exposure this validator closes.
 *
 * The check fires at module-compile time (NestJS evaluates the
 * factory when the dependency graph is built) so a misconfigured
 * production deploy fails fast with a clear error message
 * instead of silently booting with weak credentials.
 */
function resolveJwtSecret(): string {
  const secret = process.env.NAS_JWT_SECRET;
  if (!secret || secret.length === 0) {
    throw new Error(
      'NAS_JWT_SECRET is required. Set it to a random string of at least 32 bytes (256 bits) before starting alejandria-nas-backend.',
    );
  }
  if (Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error(
      `NAS_JWT_SECRET must be at least 32 bytes (256 bits) for HS256. Got ${Buffer.byteLength(secret, 'utf8')} bytes.`,
    );
  }
  return secret;
}

/**
 * Auth module — PIN pairing, JWT issuance, device persistence,
 * Bearer-token guard.
 *
 *   POST /api/auth/pair    → AuthController.pair    → AuthService.pair
 *   POST /api/auth/refresh → AuthController.refresh → AuthService.refresh
 *   Bearer protection      → JwtAuthGuard           → AuthService.resolveBearer
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
    PassportModule,
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: resolveJwtSecret(),
        signOptions: { algorithm: 'HS256' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    JwtAuthGuard,
    {
      provide: DEVICES_REPOSITORY,
      inject: [PG_POOL],
      useFactory: (pool: Pool): DevicesRepository =>
        new PgDevicesRepository(pool),
    },
  ],
  exports: [AuthService, JwtAuthGuard, DEVICES_REPOSITORY],
})
export class AuthModule {}
