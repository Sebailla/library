import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

/**
 * Resolve and validate the HMAC secret used to verify presented JWTs.
 *
 * Mirrors {@link resolveJwtSecret} in ``auth.module.ts`` — both
 * sides of the JWT flow (issuance and verification) must use the
 * same secret or signed tokens would not verify. Boot-time
 * validation here also closes the 4R-review exposure of a public
 * literal fallback for ``secretOrKey``.
 */
function resolveJwtSecretOrKey(): string {
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
 * Decoded JWT payload the strategy expects.
 *
 * ``sub`` is the device UUID; ``jti`` is the per-token random id
 * minted by ``AuthService`` to make ``refresh`` rotation
 * observable (two tokens for the same device in the same second
 * must differ).
 */
export interface JwtPayload {
  sub: string;
  jti: string;
  iat: number;
  exp: number;
}

/**
 * Passport JWT strategy used by ``JwtAuthGuard`` (or any future
 * ``@UseGuards(AuthGuard('jwt'))`` callers).
 *
 * The strategy only verifies the signature + expiry. Authoritative
 * device lookup (is the device still in the table? is the stored
 * bcrypt hash a match for the presented token?) is delegated to
 * ``AuthService.resolveBearer`` from the guard so both code paths
 * share the same revocation rules.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: resolveJwtSecretOrKey(),
    });
  }

  /**
   * Called by passport-jwt once the token's signature + expiry
   * have been verified. The returned object is attached to the
   * request as ``req.user``.
   */
  validate(payload: JwtPayload): JwtPayload {
    return payload;
  }
}
