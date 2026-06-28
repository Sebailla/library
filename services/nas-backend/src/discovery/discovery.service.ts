import { Inject, Injectable } from '@nestjs/common';
import { DiscoveryInfo } from './discovery.controller';

/**
 * String tokens used by {@link DiscoveryService} to pull its inputs
 * from the DI graph. Each one is wired by a factory provider in
 * {@link DiscoveryModule} so e2e tests can override any of them via
 * ``Test.createTestingModule(...).overrideProvider(...)``.
 *
 * Tokens are namespaced (``NAS_*``) so they cannot collide with
 * anything the existing modules inject.
 */

/** Resolved Bonjour service name the NAS publishes (``alejandria-nas.local``). */
export const MDNS_NAME = 'NAS_MDNS_NAME';

/** Resolved Tailscale IPv4 of this host, or ``null`` when Tailscale is down. */
export const TAILSCALE_IP = 'NAS_TAILSCALE_IP';

/** Non-loopback IPv4 addresses of this host. */
export const LAN_IPS = 'NAS_LAN_IPS';

/** HTTP port the API listens on (``PORT`` env var, default 3000). */
export const NAS_HTTP_PORT = 'NAS_HTTP_PORT';

/**
 * Service that assembles the {@link DiscoveryInfo} payload from
 * injected dependencies.
 *
 * The service is intentionally a thin shape-mapping adapter: every
 * fact it returns comes from a string-token provider so the
 * controller can be exercised in tests without booting Bonjour or
 * the Tailscale daemon. Production wiring lives in
 * {@link DiscoveryModule}.
 */
@Injectable()
export class DiscoveryService {
  constructor(
    @Inject(MDNS_NAME) private readonly mdnsName: string,
    @Inject(TAILSCALE_IP) private readonly tailscaleIp: string | null,
    @Inject(LAN_IPS) private readonly lanIps: string[],
    @Inject(NAS_HTTP_PORT) private readonly port: number,
  ) {}

  getInfo(): DiscoveryInfo {
    return {
      mdns_name: this.mdnsName,
      port: this.port,
      tailscale_ip: this.tailscaleIp,
      lan_ips: [...this.lanIps],
    };
  }
}
