import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { HealthService, HealthCheckResult } from './health.service';

/**
 * Health probe endpoints (4R review #38).
 *
 * Three routes, each aligned with a k8s probe pattern:
 *
 *   - ``GET /livez``  — liveness. 200 if the process is up;
 *     NEVER touches a dependency. Wire to k8s ``livenessProbe``.
 *   - ``GET /readyz`` — readiness. 200 if Postgres is reachable;
 *     Redis-down stays 200. Wire to k8s ``readinessProbe``.
 *   - ``GET /health`` — verbose diagnostic. 200 only when BOTH
 *     Postgres + Redis are reachable, 503 with per-check status
 *     otherwise. Kept for operators who need the "what's
 *     actually down" answer.
 */
@Controller()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('livez')
  @HttpCode(HttpStatus.OK)
  async live(): Promise<HealthCheckResult> {
    return this.healthService.liveness();
  }

  @Get('readyz')
  @HttpCode(HttpStatus.OK)
  async ready(): Promise<HealthCheckResult> {
    return this.healthService.readiness();
  }

  @Get('health')
  @HttpCode(HttpStatus.OK)
  async check(): Promise<HealthCheckResult> {
    return this.healthService.check();
  }
}
