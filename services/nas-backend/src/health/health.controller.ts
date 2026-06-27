import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { HealthService, HealthCheckResult } from './health.service';

/**
 * ``GET /health`` — the first contract the NAS backend exposes.
 *
 * Returns 200 when Postgres + Redis are reachable, 503 otherwise.
 * The response body always carries a ``version`` field (mirrors the
 * npm package version) and a ``timestamp`` in ISO-8601 so callers
 * can correlate logs across services.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async check(): Promise<HealthCheckResult> {
    return this.healthService.check();
  }
}
