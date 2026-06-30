import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { DEVICES_REPOSITORY } from '../../../src/auth/devices.repository';
import {
  ScanAdminGuard,
} from '../../../src/admin/scan/scan-admin.guard';
import { JwtAuthRequest } from '../../../src/auth/jwt-auth.guard';

/**
 * Contract tests for {@link ScanAdminGuard} (PR-N4).
 *
 * The guard is the second hop in the
 * ``@UseGuards(JwtAuthGuard, ScanAdminGuard)`` chain on every
 * ``/api/admin/scan/*`` route. It assumes
 * ``JwtAuthGuard`` already populated ``req.device`` and asks the
 * shared {@link DevicesRepository} whether the bearer is an admin.
 *
 * The wire contract is the same ``403 ADMIN_REQUIRED`` envelope
 * the downloads admin gate (PR-N3) shipped. Two failure modes
 * collapse into it:
 *
 *   1. ``req.device`` missing — defensive, ``JwtAuthGuard`` should
 *      never let that happen.
 *   2. The bearer's ``is_admin`` is ``false`` (or the device row
 *      does not exist).
 */

class StubDevicesRepository {
  /** Whitelist of admin device ids. Everything else is a 403. */
  constructor(private readonly adminIds: Set<string> = new Set()) {}

  async isAdmin(deviceId: string): Promise<boolean> {
    return this.adminIds.has(deviceId);
  }
}

function makeCtx(req: Partial<JwtAuthRequest>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req as JwtAuthRequest,
    }),
  } as unknown as ExecutionContext;
}

describe('ScanAdminGuard', () => {
  it('allows the request through when the bearer device is an admin', async () => {
    const guard = new ScanAdminGuard(
      new StubDevicesRepository(
        new Set(['admin-device-id']),
      ) as unknown as { isAdmin: (id: string) => Promise<boolean> } & {
        [DEVICES_REPOSITORY]: never;
      } as never,
    );
    const ok = await guard.canActivate(
      makeCtx({
        headers: {},
        device: {
          id: 1,
          deviceId: 'admin-device-id',
          deviceName: null,
          tokenHash: 'h',
          pairedAt: new Date(),
          lastSeenAt: null,
          ipAddress: null,
          isAdmin: true,
        },
      }),
    );
    expect(ok).toBe(true);
  });

  it('throws 403 ADMIN_REQUIRED when the bearer device is NOT an admin', async () => {
    const guard = new ScanAdminGuard(
      new StubDevicesRepository() as unknown as { isAdmin: (id: string) => Promise<boolean> } & {
        [DEVICES_REPOSITORY]: never;
      } as never,
    );
    await expect(
      guard.canActivate(
        makeCtx({
          headers: {},
          device: {
            id: 2,
            deviceId: 'plain-device-id',
            deviceName: null,
            tokenHash: 'h',
            pairedAt: new Date(),
            lastSeenAt: null,
            ipAddress: null,
            isAdmin: false,
          },
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    try {
      await guard.canActivate(
        makeCtx({
          headers: {},
          device: {
            id: 2,
            deviceId: 'plain-device-id',
            deviceName: null,
            tokenHash: 'h',
            pairedAt: new Date(),
            lastSeenAt: null,
            ipAddress: null,
            isAdmin: false,
          },
        }),
      );
    } catch (err) {
      expect((err as ForbiddenException).getResponse()).toEqual({
        error: { code: 'ADMIN_REQUIRED', message: 'admin role required' },
      });
    }
  });

  it('throws 403 ADMIN_REQUIRED when req.device is missing (defensive)', async () => {
    const guard = new ScanAdminGuard(
      new StubDevicesRepository() as unknown as { isAdmin: (id: string) => Promise<boolean> } & {
        [DEVICES_REPOSITORY]: never;
      } as never,
    );
    await expect(
      guard.canActivate(makeCtx({ headers: {} })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('throws 403 ADMIN_REQUIRED when the bearer device row does not exist', async () => {
    // ``isAdmin`` returns ``false`` for unknown ids by contract;
    // the guard must surface the same 403, never 500.
    const guard = new ScanAdminGuard(
      new StubDevicesRepository() as unknown as { isAdmin: (id: string) => Promise<boolean> } & {
        [DEVICES_REPOSITORY]: never;
      } as never,
    );
    await expect(
      guard.canActivate(
        makeCtx({
          headers: {},
          device: {
            id: 3,
            deviceId: 'unknown-device-id',
            deviceName: null,
            tokenHash: 'h',
            pairedAt: new Date(),
            lastSeenAt: null,
            ipAddress: null,
            isAdmin: false,
          },
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});