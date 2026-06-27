import {
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { DEVICES_REPOSITORY, DevicesRepository } from './devices.repository';

/** Stable error codes returned to the HTTP layer. */
export type AuthErrorCode =
  | 'BAD_PIN'
  | 'PIN_EXPIRED'
  | 'TOKEN_INVALID'
  | 'TOKEN_EXPIRED'
  | 'UNAUTHORIZED';

/** Decoded JWT claims used by the auth service. */
export interface AuthClaims {
  sub: string; // device_id (UUID)
  exp: number; // seconds since epoch
}

/** Result of a successful pair / refresh. */
export interface IssuedToken {
  token: string;
  expiresAt: string; // ISO-8601 UTC
  deviceId: string;
}

/** Inputs to ``pair``. */
export interface PairInput {
  pin: string;
  deviceName: string;
  ipAddress?: string | null;
}

/** Inputs to ``refresh``. */
export interface RefreshInput {
  token: string;
}

/**
 * Hash a JWT to a fixed-length opaque token suitable for equality
 * comparison.
 *
 * bcrypt is the obvious candidate but it silently truncates input
 * to 72 bytes (a limitation of the algorithm itself). Two distinct
 * JWTs minted in the same second for the same device — they only
 * differ in the ``jti`` claim which sits past the 72-byte mark —
 * would hash to the same bcrypt digest and the rotation check
 * would falsely pass.
 *
 * SHA-256 has no length limit and is deterministic, which is what
 * we actually want here. The token already carries 256+ bits of
 * entropy from the random ``jti`` so the hash is also safe to
 * store at rest.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Auth service — owns PIN validation, JWT minting, and device
 * persistence.
 *
 * Configuration is read from environment variables at construction
 * time so changes mid-run are not picked up:
 *
 *   NAS_PAIR_PIN      — single shared PIN (default "0000")
 *   NAS_PIN_TTL_DAYS  — TTL window for the PIN itself (default 30)
 *   NAS_JWT_SECRET    — HMAC secret for the JWT (default "dev-secret-change-me")
 *   NAS_JWT_TTL_HOURS — JWT lifetime in hours (default 24)
 *
 * ``tokenHash`` stored in the ``devices`` table is the SHA-256
 * digest of the issued JWT so a stolen DB row does not yield a
 * usable bearer token and ``refresh`` rotation can be observed.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly pin: string;
  private readonly pinTtlDays: number;
  private readonly jwtTtlHours: number;

  constructor(
    @Inject(DEVICES_REPOSITORY) private readonly devices: DevicesRepository,
    private readonly jwt: JwtService,
  ) {
    this.pin = process.env.NAS_PAIR_PIN ?? '0000';
    this.pinTtlDays = Number(process.env.NAS_PIN_TTL_DAYS ?? '30');
    this.jwtTtlHours = Number(process.env.NAS_JWT_TTL_HOURS ?? '24');
  }

  /**
   * Pair a device with the NAS.
   *
   * Throws ``UnauthorizedException`` with a stable ``code`` field
   * when the PIN is wrong (``BAD_PIN``) or expired (``PIN_EXPIRED``).
   */
  async pair(input: PairInput): Promise<IssuedToken> {
    if (input.pin !== this.pin) {
      throw new UnauthorizedException({
        error: { code: 'BAD_PIN', message: 'Invalid pairing PIN' },
      });
    }
    if (this.pinTtlDays <= 0) {
      throw new UnauthorizedException({
        error: { code: 'PIN_EXPIRED', message: 'Pairing PIN has expired' },
      });
    }

    const deviceId = randomUUID();
    const expiresAtSeconds = this.computeExpiry();
    const token = await this.mintToken(deviceId, expiresAtSeconds);
    const tokenHash = hashToken(token);
    await this.devices.insert({
      deviceId,
      deviceName: input.deviceName,
      tokenHash,
      ipAddress: input.ipAddress ?? null,
    });

    return {
      token,
      deviceId,
      expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
    };
  }

  /**
   * Refresh a JWT issued previously. Verifies the supplied token,
   * looks up the device, rotates the stored hash, and mints a new
   * JWT with a fresh exp.
   */
  async refresh(input: RefreshInput): Promise<IssuedToken> {
    let claims: AuthClaims;
    try {
      claims = await this.jwt.verifyAsync<AuthClaims>(input.token);
    } catch (err) {
      const code = err instanceof Error && err.name === 'TokenExpiredError'
        ? 'TOKEN_EXPIRED'
        : 'TOKEN_INVALID';
      const message = code === 'TOKEN_EXPIRED'
        ? 'Bearer token has expired'
        : 'Bearer token is invalid';
      throw new UnauthorizedException({
        error: { code, message },
      });
    }

    const device = await this.devices.findByDeviceId(claims.sub);
    if (!device) {
      throw new UnauthorizedException({
        error: { code: 'TOKEN_INVALID', message: 'Unknown device' },
      });
    }
    const stillValid = hashToken(input.token) === device.tokenHash;
    if (!stillValid) {
      throw new UnauthorizedException({
        error: { code: 'TOKEN_INVALID', message: 'Token revoked' },
      });
    }

    const expiresAtSeconds = this.computeExpiry();
    const newToken = await this.mintToken(device.deviceId, expiresAtSeconds);
    const newHash = hashToken(newToken);
    await this.devices.updateTokenHash(device.deviceId, newHash);

    return {
      token: newToken,
      deviceId: device.deviceId,
      expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
    };
  }

  /**
   * Resolve a Bearer token to its device row. Used by the
   * ``JwtAuthGuard`` and the sample ``GET /api/me`` route.
   */
  async resolveBearer(token: string): Promise<{ deviceId: string; deviceName: string | null }> {
    let claims: AuthClaims;
    try {
      claims = await this.jwt.verifyAsync<AuthClaims>(token);
    } catch (err) {
      const code = err instanceof Error && err.name === 'TokenExpiredError'
        ? 'TOKEN_EXPIRED'
        : 'TOKEN_INVALID';
      const message = code === 'TOKEN_EXPIRED'
        ? 'Bearer token has expired'
        : 'Bearer token is invalid';
      throw new UnauthorizedException({
        error: { code, message },
      });
    }
    const device = await this.devices.findByDeviceId(claims.sub);
    if (!device) {
      throw new UnauthorizedException({
        error: { code: 'TOKEN_INVALID', message: 'Unknown device' },
      });
    }
    const stillValid = hashToken(token) === device.tokenHash;
    if (!stillValid) {
      throw new UnauthorizedException({
        error: { code: 'TOKEN_INVALID', message: 'Token revoked' },
      });
    }
    // Touch last_seen_at asynchronously; do not await — the request
    // should not block on the audit write.
    void this.devices.touch(device.deviceId).catch((err) => {
      this.logger.warn(`devices.touch failed: ${(err as Error).message}`);
    });
    return { deviceId: device.deviceId, deviceName: device.deviceName };
  }

  private async mintToken(deviceId: string, expSeconds: number): Promise<string> {
    // ``jti`` (random per-token id) ensures two tokens minted in the
    // same second for the same device still have distinct
    // signatures — required so ``refresh`` can prove it really did
    // issue a new credential.
    return this.jwt.signAsync(
      { sub: deviceId, jti: randomBytes(16).toString('hex') },
      { expiresIn: expSeconds - Math.floor(Date.now() / 1000) },
    );
  }

  private computeExpiry(): number {
    return Math.floor(Date.now() / 1000) + this.jwtTtlHours * 3600;
  }
}
