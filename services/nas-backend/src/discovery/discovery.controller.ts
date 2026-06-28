import { Controller, Get } from '@nestjs/common';
import { DiscoveryService } from './discovery.service';

/**
 * Body shape returned by ``GET /api/discovery/info``.
 *
 * Documented in ``openspec/changes/alejandria-v2/specs/
 * nas-discovery-auth/spec.md`` § "Tailscale discovery fallback" —
 * the discovery endpoint is the public hand-shake clients use to
 * find the NAS before they have a bearer token, so it MUST NOT
 * sit behind ``JwtAuthGuard``.
 */
export interface DiscoveryInfo {
  mdns_name: string;
  port: number;
  tailscale_ip: string | null;
  lan_ips: string[];
}

/**
 * ``GET /api/discovery/info`` — public discovery endpoint (PR-2F).
 *
 * Returns the four facts a LAN client needs to reach the NAS:
 *
 *   - ``mdns_name``    — the Bonjour host name we publish
 *                        (``alejandria-nas.local``) so a Mac / iPad
 *                        can ``ping alejandria-nas.local`` and get
 *                        an IP without DNS / DHCP coordination.
 *   - ``port``         — the HTTP port the API listens on
 *                        (``PORT`` env var, default 3000).
 *   - ``tailscale_ip`` — the host's Tailscale IPv4 (``100.x.x.x``)
 *                        when ``tailscale up`` is running, or
 *                        ``null`` when Tailscale is not installed /
 *                        not running. Mac / iPad use this to reach
 *                        the NAS over WAN through the tailnet.
 *   - ``lan_ips``      — every non-loopback IPv4 the host owns, so
 *                        a client on the same LAN can hit the API
 *                        directly without relying on mDNS.
 *
 * The endpoint is intentionally open (no ``@UseGuards``) because
 * pairing depends on it: a device needs to discover the NAS before
 * it can ``POST /api/auth/pair`` to mint a token.
 */
@Controller({ path: 'api/discovery', version: undefined })
export class DiscoveryController {
  constructor(private readonly discoveryService: DiscoveryService) {}

  @Get('info')
  info(): DiscoveryInfo {
    return this.discoveryService.getInfo();
  }
}
