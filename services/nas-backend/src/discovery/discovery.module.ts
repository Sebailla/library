import { Module } from '@nestjs/common';
import { DiscoveryController } from './discovery.controller';
import {
  DiscoveryService,
  LAN_IPS,
  MDNS_NAME,
  NAS_HTTP_PORT,
  TAILSCALE_IP,
} from './discovery.service';
import {
  BONJOUR,
  defaultBonjourFactory,
  MDNS_SERVICE_HOST,
  MDNS_SERVICE_NAME,
  MDNS_SERVICE_PORT,
  MdnsService,
} from './mdns.service';

/**
 * Discovery module — ``GET /api/discovery/info`` (PR-2F).
 *
 * Wires {@link DiscoveryController} against {@link DiscoveryService}
 * which assembles the four facts a LAN / Tailscale client needs to
 * reach the NAS:
 *
 *   - mDNS service name (published by {@link MdnsService})
 *   - HTTP port (``PORT`` env var, default 3000)
 *   - Tailscale IPv4 (probed by ``tailscale.service.ts`` — committed
 *     later in this work unit)
 *   - LAN IPv4 list (from ``os.networkInterfaces()`` — wired to an
 *     empty array until the Tailscale service commit lands; the
 *     LAN provider below is updated there to enumerate interfaces)
 *
 * Each fact is injected through a string token so e2e tests can
 * override any of them via
 * ``Test.createTestingModule(...).overrideProvider(...)`` and the
 * service has zero hard-coded production defaults.
 *
 * The real {@link MdnsService} boots inside this module via
 * ``OnModuleInit``: it opens the Bonjour responder and publishes
 * ``_alejandria._tcp`` with the host's first LAN IP. The publish
 * is non-blocking on errors so a missing mDNS responder (e.g. a
 * QNAP container without Avahi) does NOT prevent the API from
 * serving HTTP.
 */
@Module({
  controllers: [DiscoveryController],
  providers: [
    DiscoveryService,
    MdnsService,
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
      // Best-effort first LAN IPv4. Until TailscaleService lands
      // we pin a sensible default so the Bonjour responder still
      // gets a host string to advertise.
      provide: MDNS_SERVICE_HOST,
      useFactory: (): string => '0.0.0.0',
    },
    {
      provide: BONJOUR,
      useFactory: defaultBonjourFactory,
    },
    {
      // Until TailscaleService lands in the next commit we expose
      // ``null`` so clients can see the "Tailscale down" state.
      provide: TAILSCALE_IP,
      useFactory: (): string | null => null,
    },
    {
      // Until TailscaleService lands we expose an empty LAN list.
      // The next commit replaces this with ``os.networkInterfaces()``.
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
