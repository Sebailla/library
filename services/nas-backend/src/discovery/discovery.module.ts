import { Module } from '@nestjs/common';
import { DiscoveryController } from './discovery.controller';
import {
  DiscoveryService,
  LAN_IPS,
  MDNS_NAME,
  NAS_HTTP_PORT,
  TAILSCALE_IP,
} from './discovery.service';

/**
 * Discovery module — ``GET /api/discovery/info`` (PR-2F).
 *
 * Wires {@link DiscoveryController} against {@link DiscoveryService}
 * which assembles the four facts a LAN / Tailscale client needs to
 * reach the NAS:
 *
 *   - mDNS service name (published by ``mdns.service.ts``)
 *   - HTTP port (``PORT`` env var, default 3000)
 *   - Tailscale IPv4 (probed by ``tailscale.service.ts``)
 *   - LAN IPv4 list (from ``os.networkInterfaces()``)
 *
 * Each fact is injected through a string token so e2e tests can
 * override any of them via
 * ``Test.createTestingModule(...).overrideProvider(...)`` and the
 * service has zero hard-coded production defaults.
 *
 * The real {@link MdnsService} and {@link TailscaleService} land in
 * follow-up commits (commits 3 + 4 of this work unit). Until then
 * the factories here return safe stub values so the rest of the
 * app boots cleanly:
 *
 *   - ``MDNS_NAME``      → ``alejandria-nas.local``
 *   - ``TAILSCALE_IP``   → ``null`` (no Tailscale yet)
 *   - ``LAN_IPS``        → ``[]`` (filled in by Tailscale PR)
 *   - ``NAS_HTTP_PORT``  → ``process.env.PORT ?? 3000``
 */
@Module({
  controllers: [DiscoveryController],
  providers: [
    DiscoveryService,
    {
      provide: MDNS_NAME,
      useFactory: (): string => 'alejandria-nas.local',
    },
    {
      provide: TAILSCALE_IP,
      useFactory: (): string | null => null,
    },
    {
      provide: LAN_IPS,
      useFactory: (): string[] => [],
    },
    {
      provide: NAS_HTTP_PORT,
      useFactory: (): number => Number(process.env.PORT ?? 3000),
    },
  ],
})
export class DiscoveryModule {}
