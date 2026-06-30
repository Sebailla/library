import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { JwtAuthRequest } from '../../auth/jwt-auth.guard';
import {
  DEVICES_REPOSITORY,
  DevicesRepository,
} from '../../auth/devices.repository';

/**
 * Admin guard — PR-N4.
 *
 * The downloads admin gate (PR-N3) implemented this check inline
 * in the controller. PR-N4 lifts the contract into its own guard
 * so the ``/api/admin/scan/*`` family can
 * ``@UseGuards(JwtAuthGuard, ScanAdminGuard)`` without repeating
 * the ``assertAdmin(req)`` helper in every method.
 *
 * Two failure modes collapse into the same ``403 ADMIN_REQUIRED``
 * envelope so the wire shape is stable for clients:
 *
 *   1. ``req.device`` is missing — ``JwtAuthGuard`` should have
 *      rejected without a device, but if it ever did not we must
 *      not silently let the request through.
 *   2. ``req.device.deviceId`` resolves to a row whose
 *      ``is_admin`` column is ``false`` (or to no row at all).
 *
 * ``DevicesRepository.isAdmin`` is the same read-only helper the
 * downloads gate uses, so both surfaces stay consistent.
 */
export class ScanAdminGuard implements CanActivate {
  constructor(
    @Inject(DEVICES_REPOSITORY)
    private readonly devices: DevicesRepository,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<JwtAuthRequest>();
    const deviceId = req.device?.deviceId;
    if (!deviceId) {
      throw new ForbiddenException({
        error: {
          code: 'ADMIN_REQUIRED',
          message: 'admin role required',
        },
      });
    }
    const isAdmin = await this.devices.isAdmin(deviceId);
    if (!isAdmin) {
      throw new ForbiddenException({
        error: {
          code: 'ADMIN_REQUIRED',
          message: 'admin role required',
        },
      });
    }
    return true;
  }
}