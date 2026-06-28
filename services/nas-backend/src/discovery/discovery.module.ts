import { Module } from '@nestjs/common';
import { networkInterfaces } from 'os';
import { DiscoveryController } from './discovery.controller';
import {
  DiscoveryService,
  LAN_IPS,
  MDNS_NAME,
  NAS_HTTP_PORT,
} from './discovery.service';
import {
  BONJOUR,
  defaultBonjourFactory,
  MDNS_SERVICE_HOST,
  MDNS_SERVICE_NAME,
  MDNS_SERVICE_PORT,
  MdnsService,
} from './mdns.service';
import {
  defaultShell,
  TAILSCALE_SHELL,
  TailscaleService,
} from './tailscale.service';
import { AuthModule } from '../auth/auth.module';

/**
 * Discovery module — ``GET /api/discovery/info`` (PR-2F).
 *
 * Wires {@link DiscoveryController} against {@link DiscoveryService}
 * which assembles the four facts a LAN / Tailscale client needs to
 * reach the NAS:
 *
 *   - mDNS service name (published by {@link MdnsService})
 *   - HTTP port (``PORT`` env var, default 3000)
 *   - Tailscale IPv4 (probed by {@link TailscaleService})
 *   - LAN IPv4 list (from ``os.networkInterfaces()``)
 *
 * Each fact is injected through a string token so e2e tests can
 * override any of them via
 * ``Test.createTestingModule(...).overrideProvider(...)`` and the
 * service has zero hard-coded production defaults.
 *
 * Both probes are non-blocking on errors: a missing mDNS responder
 * (e.g. a QNAP container without Avahi) or a missing Tailscale CLI
 * do NOT prevent the API from serving HTTP.
 */

/**
 * Best-effort LAN IPv4 enumerator used by the ``LAN_IPS`` provider.
 *
 * Returns every non-loopback IPv4 the OS reports. Falls back to
 * ``[]`` on environments where ``os.networkInterfaces()`` is not
 * available (e.g. restricted sandboxes) so the discovery endpoint
 * can still answer with an empty list instead of throwing.
 */
function listLanIps(): string[] {
  try {
    const ifaces = networkInterfaces();
    const out: string[] = [];
    for (const list of Object.values(ifaces)) {
      if (!list) continue;
      for (const info of list) {
        if (info.family === 'IPv4' && !info.internal) {
          out.push(info.address);
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Best-effort first LAN IPv4 used as the Bonjour ``host`` field.
 * Returns the first non-loopback IPv4 from
 * ``os.networkInterfaces()``, or ``'0.0.0.0'`` if none is
 * available (the responder will still come up; clients fall back
 * to mDNS resolution).
 */
function firstLanIpOrDefault(): string {
  return listLanIps()[0] ?? '0.0.0.0';
}

@Module({
  // ``AuthModule`` is imported (not just listed in providers)
  // because ``DiscoveryController`` injects ``JwtAuthGuard`` via
  // ``@UseGuards`` on ``GET /api/discovery/network`` (#44). The
  // guard itself is exported by ``AuthModule`` so the import
  // resolves it without re-declaring it here.
  imports: [AuthModule],
  controllers: [DiscoveryController],
  providers: [
    DiscoveryService,
    MdnsService,
    TailscaleService,
    {
      provide: MDNS_NAME,
      inject: [MdnsService],
      useFactory: (mdns: MdnsService): string => mdns.serviceName,
    },
    {
      provide: MDNS_SERVICE_NAME,
      useValue: 'alejandria-nas',
    },
    {
      provide: MDNS_SERVICE_PORT,
      inject: [NAS_HTTP_PORT],
      useFactory: (port: number): number => port,
    },
    {
      provide: MDNS_SERVICE_HOST,
      useFactory: (): string => firstLanIpOrDefault(),
    },
    {
      provide: BONJOUR,
      useFactory: defaultBonjourFactory,
    },
    {
      provide: TAILSCALE_SHELL,
      useFactory: (): typeof defaultShell => defaultShell,
    },
    {
      provide: LAN_IPS,
      useFactory: (): string[] => listLanIps(),
    },
    {
      provide: NAS_HTTP_PORT,
      useFactory: (): number => Number(process.env.PORT ?? 3000),
    },
  ],
})
export class DiscoveryModule {}
