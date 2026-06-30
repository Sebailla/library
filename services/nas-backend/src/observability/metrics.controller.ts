import { Controller, Get, Header, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  METRICS_SERVICE,
  MetricsService,
} from './metrics.service';

/**
 * ``GET /metrics`` — Prometheus exposition format endpoint
 * (PR-N7, issue #92).
 *
 * The endpoint is intentionally OPEN (no ``JwtAuthGuard``):
 * Prometheus scrapers run inside the LAN / Tailscale tailnet
 * and are expected to NOT carry a bearer token. Operators who
 * want to lock the endpoint down MUST front it with a
 * network-level ACL (firewall, Tailscale ACL) rather than a
 * NestJS guard; this matches the pattern used for
 * ``GET /api/discovery/info`` and ``GET /health``.
 *
 * Response headers:
 *
 *   - ``Content-Type: text/plain; version=0.0.4`` — the canonical
 *     Prometheus content type. The exact value is provided by
 *     prom-client via ``registry.contentType`` so a future
 *     upgrade to OpenMetrics metrics is one switch away.
 *   - ``Cache-Control: no-store`` — scrapers always read fresh.
 *
 * The body is the rendered registry, exactly the way
 * ``prom-client`` emits it (``# HELP`` / ``# TYPE`` headers
 * followed by the sample lines).
 */
@Controller()
export class MetricsController {
  constructor(
    @Inject(METRICS_SERVICE)
    private readonly metrics: MetricsService,
  ) {}

  @Get('metrics')
  @Header('Cache-Control', 'no-store')
  async scrape(@Res() res: Response): Promise<void> {
    const body = await this.metrics.render();
    res.setHeader('Content-Type', this.metrics.contentType);
    res.status(200).send(body);
  }
}
