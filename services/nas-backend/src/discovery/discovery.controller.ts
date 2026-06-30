import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { DiscoveryService } from './discovery.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
} from '../common/openapi.decorators';

/**
 * Body shape returned by the pre-auth ``GET /api/discovery/info``
 * endpoint (#44, 4R review).
 *
 * Only the two facts a brand-new client needs to even attempt
 * pairing are exposed here: the mDNS service name (so Mac / iPad
 * can resolve the host without DNS / DHCP coordination) and the
 * HTTP port. Network-internal details (tailscale IPv4, LAN IPs)
 * are deliberately NOT exposed — they live behind
 * {@link DiscoveryNetwork}.
 */
export interface DiscoveryInfo {
  mdns_name: string;
  port: number;
}

/**
 * Body shape returned by the auth-required
 * ``GET /api/discovery/network`` endpoint (#44, 4R review).
 *
 * The split from {@link DiscoveryInfo} closes the reconnaissance
 * exposure: the LAN + Tailscale surface is only revealed after
 * the caller has paired via ``POST /api/auth/pair`` and carries
 * a valid Bearer token.
 */
export interface DiscoveryNetwork {
  tailscale_ip: string | null;
  lan_ips: string[];
}

/**
 * Discovery endpoints (PR-2F, split in PR-2F.1 for #44).
 *
 *   GET /api/discovery/info      → DiscoveryInfo      (pre-auth)
 *   GET /api/discovery/network   → DiscoveryNetwork   (auth)
 *
 * ``/info`` is the public hand-shake clients use to find the
 * NAS before they have a bearer token — it MUST NOT sit behind
 * ``JwtAuthGuard``. Pairing depends on it: a device needs to
 * discover the NAS before it can ``POST /api/auth/pair`` to
 * mint a token.
 *
 * ``/network`` is the network-internal view (tailscale IP +
 * LAN IPs). It MUST be protected: an unauthenticated caller
 * must not be able to enumerate the NAS network surface just
 * because they can reach mDNS.
 */
@ApiTags('discovery')
@Controller({ path: 'api/discovery', version: undefined })
export class DiscoveryController {
  constructor(private readonly discoveryService: DiscoveryService) {}

  /**
   * Pre-auth discovery. Returns ONLY the mDNS service name and
   * HTTP port — never the IP surface.
   */
  @Get('info')
  @ApiOperation({
    summary: 'Pre-auth discovery handshake',
    description:
      'Returns the mDNS service name and HTTP port so a brand-new client can locate the NAS BEFORE pairing. Deliberately omits the IP surface — see `GET /api/discovery/network` for that (auth-required).',
  })
  @ApiOkResponse({
    description: 'Discovery handshake',
    schema: {
      example: {
        mdns_name: 'alejandria-nas._alejandria._tcp.local',
        port: 3000,
      },
    },
  })
  async info(): Promise<DiscoveryInfo> {
    const full = await this.discoveryService.getFull();
    return {
      mdns_name: full.mdns_name,
      port: full.port,
    };
  }

  /**
   * Auth-required network view. Returns the tailscale IP and LAN
   * IPv4 list. Behind {@link JwtAuthGuard} so only paired devices
   * can read them.
   */
  @Get('network')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Auth-required network view (Tailscale IP + LAN list)',
    description:
      'Reveals the Tailscale IPv4 (or `null` when Tailscale is down) and the host LAN IPv4 list. Bearer token required — a paired device can read this after `POST /api/auth/pair`.',
  })
  @ApiOkResponse({
    description: 'Network surface for the NAS host',
    schema: {
      example: {
        tailscale_ip: '100.64.1.5',
        lan_ips: ['192.168.1.42'],
      },
    },
  })
  @ApiUnauthorizedResponse()
  @ApiForbiddenResponse()
  async network(): Promise<DiscoveryNetwork> {
    const full = await this.discoveryService.getFull();
    return {
      tailscale_ip: full.tailscale_ip,
      lan_ips: [...full.lan_ips],
    };
  }
}
