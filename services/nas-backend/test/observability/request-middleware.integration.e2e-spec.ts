import { Controller, Get } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { MetricsController } from '../../src/observability/metrics.controller';
import {
  METRICS_SERVICE,
  MetricsService,
} from '../../src/observability/metrics.service';
import { buildRequestMiddleware } from '../../src/observability/request-middleware';
import { requestLogger } from '../../src/observability/request-logger';
import { HealthController } from '../../src/health/health.controller';
import { HealthService } from '../../src/health/health.service';
import { RequestContext } from '../../src/observability/request-context';

/**
 * PR-N7 (issue #92) — request middleware integration test.
 *
 * Pins the four behaviours that only show up once the middleware
 * is mounted against a real Express app:
 *
 *   - The middleware mints a request id and echoes it back via
 *     the ``X-Request-Id`` response header.
 *   - The middleware honours an inbound ``X-Request-Id`` and the
 *     header is round-tripped verbatim.
 *   - Every request bumps ``http_requests_total`` by exactly one
 *     sample (the scrape endpoint hits itself twice = two samples
 *     in the same series).
 *   - The AsyncLocalStorage envelope is alive at least until the
 *     controller executes (read via ``RequestContext.get()``
 *     from inside the probe controller).
 */
@Controller('probe')
class ProbeController {
  @Get('context')
  context(): { request_id: string | undefined; method: string | undefined } {
    const ctx = RequestContext.get();
    return {
      request_id: ctx?.request_id,
      method: ctx?.method,
    };
  }
}

describe('Observability: request middleware integration (PR-N7)', () => {
  async function buildApp(): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({
      controllers: [MetricsController, ProbeController, HealthController],
      providers: [
        MetricsService,
        {
          provide: METRICS_SERVICE,
          useExisting: MetricsService,
        },
        {
          provide: HealthService,
          useValue: {
            liveness: () => Promise.resolve({ status: 'ok' }),
            readiness: () => Promise.resolve({ status: 'ok' }),
            check: () => Promise.resolve({ status: 'ok' }),
          },
        },
      ],
    }).compile();
    const testApp = moduleRef.createNestApplication();
    // Mirror ``main.ts`` ordering: mount the middleware BEFORE
    // ``init()`` so it sits in front of every request, including
    // 404 fall-throughs.
    const lazyMetrics = {
      recordHttpRequest: (
        ...args: Parameters<MetricsService['recordHttpRequest']>
      ): void => {
        const svc = testApp.get<MetricsService>(METRICS_SERVICE);
        svc.recordHttpRequest(...args);
      },
    };
    testApp.use(buildRequestMiddleware({ metrics: lazyMetrics }));
    await testApp.init();
    await testApp.get(MetricsService).onApplicationBootstrap();
    return testApp;
  }

  it('mints a request id on /livez and echoes it back via X-Request-Id', async () => {
    const app = await buildApp();
    try {
      const res = await request(app.getHttpServer())
        .get('/livez')
        .expect(200);
      const header = res.headers['x-request-id'];
      expect(typeof header).toBe('string');
      expect(/^[0-9a-f]{32}$/.test(header as string)).toBe(true);
      const metrics = app.get<MetricsService>(METRICS_SERVICE);
      const text = await metrics.render();
      const matches = text.match(
        /http_requests_total\{[^}]*path="\/livez"[^}]*\} (\d+)/,
      );
      expect(matches).not.toBeNull();
      expect(Number(matches![1])).toBeGreaterThanOrEqual(1);
    } finally {
      await app.close();
    }
  });

  it('honours an inbound X-Request-Id and round-trips it back to the caller', async () => {
    const app = await buildApp();
    try {
      const res = await request(app.getHttpServer())
        .get('/livez')
        .set('X-Request-Id', 'caller-supplied-id')
        .expect(200);
      expect(res.headers['x-request-id']).toBe('caller-supplied-id');
    } finally {
      await app.close();
    }
  });

  it('seeds the AsyncLocalStorage envelope so request_id is readable inside the controller', async () => {
    const app = await buildApp();
    try {
      // /probe/context is registered behind the middleware, so
      // the controller body MUST see the same request_id the
      // caller supplied.
      const res = await request(app.getHttpServer())
        .get('/probe/context')
        .set('X-Request-Id', 'inside-controller')
        .expect(200);
      expect(res.body).toEqual({
        request_id: 'inside-controller',
        method: 'GET',
      });
    } finally {
      await app.close();
    }
  });

  it('records the HTTP counter for the /metrics endpoint itself when scraped', async () => {
    const app = await buildApp();
    try {
      await request(app.getHttpServer()).get('/metrics').expect(200);
      await request(app.getHttpServer()).get('/metrics').expect(200);
      const metrics = app.get<MetricsService>(METRICS_SERVICE);
      const text = await metrics.render();
      const matches = text.match(
        /http_requests_total\{[^}]*path="\/metrics"[^}]*status="200"[^}]*\} (\d+)/,
      );
      expect(matches).not.toBeNull();
      expect(Number(matches![1])).toBe(2);
    } finally {
      await app.close();
    }
  });

  it('exports a callable requestLogger singleton usable from background tasks', () => {
    // No ALS scope is active here; the logger must accept this
    // and emit a JSON line without request_id.
    expect(() => requestLogger.info({ event: 'bootstrap' }, 'hi')).not.toThrow();
  });
});
