import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Device } from './devices.repository';

/**
 * Minimal request shape the guard relies on. Keeping the surface
 * tiny means controllers can be tested without the full Express
 * type graph.
 */
export interface JwtAuthRequest {
  headers: { authorization?: string | undefined };
  device?: Device;
}

/**
 * Bearer-token guard.
 *
 * Reads ``Authorization: Bearer <jwt>``, delegates to
 * ``AuthService.resolveBearer``, and attaches the resolved device
 * to ``req.device`` so downstream handlers can read it without
 * re-verifying the token.
 *
 * Any failure throws ``UnauthorizedException`` whose body carries
 * the stable ``error.code`` documented in the spec:
 *
 *   UNAUTHORIZED       — header missing or malformed
 *   TOKEN_INVALID      — signature/format invalid
 *   TOKEN_EXPIRED      — exp in the past
 */
@Injectable()
export class JwtAuthGuard {
  constructor(private readonly authService: AuthService) {}

  async canActivate(ctx: {
    switchToHttp: () => { getRequest: () => JwtAuthRequest };
  }): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const header = req.headers?.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException({
        error: { code: 'UNAUTHORIZED', message: 'Missing Bearer token' },
      });
    }
    const token = header.slice('Bearer '.length).trim();
    if (!token) {
      throw new UnauthorizedException({
        error: { code: 'UNAUTHORIZED', message: 'Empty Bearer token' },
      });
    }
    try {
      const resolved = await this.authService.resolveBearer(token);
      // Attach the resolved identity so handlers can read it
      // without re-running the verification chain.
      req.device = {
        deviceId: resolved.deviceId,
        deviceName: resolved.deviceName,
      } as Device;
      return true;
    } catch (err) {
      if (err instanceof UnauthorizedException) {
        // ``AuthService.resolveBearer`` already returns a
        // properly-shaped payload; pass it through unchanged.
        throw err;
      }
      throw new UnauthorizedException({
        error: { code: 'TOKEN_INVALID', message: 'Bearer verification failed' },
      });
    }
  }
}
