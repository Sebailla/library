import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

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
      secretOrKey: process.env.NAS_JWT_SECRET ?? 'dev-secret-change-me',
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
