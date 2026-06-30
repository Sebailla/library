import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ApiServiceUnavailableResponse } from '../common/openapi.decorators';
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
@ApiTags('health')
@Controller()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('livez')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Liveness probe',
    description:
      'Returns 200 whenever the process is up. Does NOT touch a dependency — k8s uses this to decide whether to RESTART the pod, so a transient DB / Redis blip MUST never restart us.',
  })
  @ApiOkResponse({ description: 'Process is alive' })
  async live(): Promise<HealthCheckResult> {
    return this.healthService.liveness();
  }

  @Get('readyz')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Readiness probe',
    description:
      'Returns 200 when Postgres is reachable. Redis-down stays 200 because the HTTP layer is fully functional on Postgres alone; only the BullMQ workers require Redis and they self-disable when the broker is unreachable.',
  })
  @ApiOkResponse({ description: 'Postgres is reachable' })
  @ApiServiceUnavailableResponse({
    description: 'Postgres is unreachable — pod is not ready to serve',
  })
  async ready(): Promise<HealthCheckResult> {
    return this.healthService.readiness();
  }

  @Get('health')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verbose diagnostic — checks both Postgres and Redis',
    description:
      'Returns 200 only when BOTH Postgres + Redis are reachable; 503 with per-check status otherwise. Kept for operators who need the "what is actually down" answer.',
  })
  @ApiOkResponse({ description: 'Both Postgres and Redis are reachable' })
  @ApiServiceUnavailableResponse({
    description: 'At least one dependency is unreachable',
  })
  async check(): Promise<HealthCheckResult> {
    return this.healthService.check();
  }
}
