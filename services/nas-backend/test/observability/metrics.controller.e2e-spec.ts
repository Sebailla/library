import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { MetricsController } from '../../src/observability/metrics.controller';
import {
  METRICS_SERVICE,
  MetricsService,
} from '../../src/observability/metrics.service';

/**
 * PR-N7 (issue #92) — ``GET /metrics`` endpoint contract tests.
 *
 * The endpoint:
 *
 *   - Responds 200 with the Prometheus exposition format and the
 *     ``text/plain; version=0.0.4`` content type that scrape jobs
 *     recognise.
 *   - Returns the project counters and histograms.
 *   - Is mounted at the root (``/metrics``) — NOT under ``/api`` —
 *     so the same path is used regardless of the API versioning
 *     evolution.
 *
 * The tests build the controller with a real ``MetricsService``
 * (no DI stubs) so the wire format is genuinely the prom-client
 * output, not a hand-rolled fake.
 */
describe('GET /metrics (Prometheus exposition format)', () => {
  async function buildApp(): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({
      controllers: [MetricsController],
      providers: [
        MetricsService,
        {
          provide: METRICS_SERVICE,
          useExisting: MetricsService,
        },
      ],
    }).compile();
    const testApp = moduleRef.createNestApplication();
    await testApp.init();
    await testApp.get(MetricsService).onApplicationBootstrap();
    return testApp;
  }

  it('returns 200 with text/plain Prometheus content type', async () => {
    const app = await buildApp();
    try {
      const res = await request(app.getHttpServer()).get('/metrics').expect(200);
      expect(res.headers['content-type']).toMatch(/^text\/plain/);
      expect(typeof res.text).toBe('string');
      // Counters + histograms for PR-N7 are visible in the body.
      expect(res.text).toContain('http_requests_total');
      expect(res.text).toContain('scan_jobs_total');
      expect(res.text).toContain('downloads_total');
      expect(res.text).toContain('http_request_duration_seconds');
      expect(res.text).toContain('scan_job_duration_seconds');
      expect(res.text).toContain('download_bytes');
    } finally {
      await app.close();
    }
  });

  it('reflects counter increments performed during the test lifetime', async () => {
    const app = await buildApp();
    try {
      const svc = app.get<MetricsService>(METRICS_SERVICE);
      svc.recordHttpRequest('GET', '/livez', 200, 0.001);
      svc.recordHttpRequest('GET', '/livez', 200, 0.001);
      svc.recordScanJob('done');
      svc.recordDownload('completed', 4096);
      const res = await request(app.getHttpServer()).get('/metrics').expect(200);
      expect(res.text).toMatch(
        /http_requests_total\{method="GET",path="\/livez",status="200"\} 2/,
      );
      expect(res.text).toMatch(/scan_jobs_total\{status="done"\} 1/);
      expect(res.text).toMatch(/downloads_total\{state="completed"\} 1/);
    } finally {
      await app.close();
    }
  });

  it('is reachable without an Authorization header (Prometheus scrapers do not auth)', async () => {
    const app = await buildApp();
    try {
      const res = await request(app.getHttpServer())
        .get('/metrics')
        .expect(200);
      expect(res.text).toContain('http_requests_total');
    } finally {
      await app.close();
    }
  });
});
