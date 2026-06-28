import { Inject, Injectable } from '@nestjs/common';
import { DiscoveryInfo } from './discovery.controller';
import { TailscaleService } from './tailscale.service';

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

/** Non-loopback IPv4 addresses of this host. */
export const LAN_IPS = 'NAS_LAN_IPS';

/** HTTP port the API listens on (``PORT`` env var, default 3000). */
export const NAS_HTTP_PORT = 'NAS_HTTP_PORT';

/**
 * Service that assembles the {@link DiscoveryInfo} payload from
 * injected dependencies.
 *
 * The Tailscale probe is delegated to {@link TailscaleService}
 * because the IP is fetched asynchronously (shell-out) and may
 * legitimately return ``null``. The Bonjour name, HTTP port and
 * LAN IP list are pure synchronous values read from string-token
 * providers so they can be overridden in tests.
 *
 * The service is intentionally a thin shape-mapping adapter:
 * production wiring lives in {@link DiscoveryModule}.
 */
@Injectable()
export class DiscoveryService {
  constructor(
    @Inject(MDNS_NAME) private readonly mdnsName: string,
    @Inject(LAN_IPS) private readonly lanIps: string[],
    @Inject(NAS_HTTP_PORT) private readonly port: number,
    private readonly tailscale: TailscaleService,
  ) {}

  async getInfo(): Promise<DiscoveryInfo> {
    return {
      mdns_name: this.mdnsName,
      port: this.port,
      tailscale_ip: await this.tailscale.getIp(),
      lan_ips: [...this.lanIps],
    };
  }
}
