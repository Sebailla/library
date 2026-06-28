import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, JwtAuthRequest } from '../auth/jwt-auth.guard';

/**
 * Sample protected route — ``GET /api/me``.
 *
 * Demonstrates the ``JwtAuthGuard`` end-to-end. After a device
 * pairs it can call this endpoint to verify its Bearer token is
 * still valid and read back the server-side ``device_name`` it
 * registered with. The shape is intentionally tiny because the
 * real profile data lands in chained PRs.
 *
 * Lives under ``me/`` (not ``auth/``) so future profile endpoints
 * (``PATCH /api/me``, ``GET /api/me/preferences``) can be added
 * without polluting the auth module.
 */
@Controller({ path: 'api/me', version: undefined })
@UseGuards(JwtAuthGuard)
export class MeController {
  @Get()
  me(@Req() req: JwtAuthRequest): {
    device_id: string;
    device_name: string | null;
  } {
    const device = req.device;
    return {
      device_id: device?.deviceId ?? '',
      device_name: device?.deviceName ?? null,
    };
  }
}
