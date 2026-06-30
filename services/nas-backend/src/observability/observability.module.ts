import { Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { METRICS_SERVICE, MetricsService } from './metrics.service';

/**
 * Observability module — PR-N7 (issue #92).
 *
 * Wires:
 *
 *   - ``MetricsService`` — singleton prom-client registry,
 *     registered under the ``METRICS_SERVICE`` token so the
 *     HTTP middleware (mounted in ``main.ts``) and the scan /
 *     downloads instrumentation can resolve the SAME instance.
 *   - ``MetricsController`` — ``GET /metrics`` returning the
 *     Prometheus exposition format. No auth (scrapers don't
 *     carry bearer tokens).
 *
 * The HTTP middleware is mounted in ``main.ts`` via
 * ``app.use(buildRequestMiddleware({ metrics: app.get(...)
 * }))`` because middleware needs access to the underlying
 * Express adapter outside the controllers graph — the same
 * pattern as the OpenAPI bootstrap. The middleware is
 * NOT registered here as a NestJS ``MiddlewareConsumer`` hook
 * because it is mounted BEFORE the NestJS router so it can
 * observe every request (including 404 fall-throughs).
 */
@Module({
  controllers: [MetricsController],
  providers: [
    MetricsService,
    {
      provide: METRICS_SERVICE,
      useExisting: MetricsService,
    },
  ],
  exports: [MetricsService, METRICS_SERVICE],
})
export class ObservabilityModule {}
