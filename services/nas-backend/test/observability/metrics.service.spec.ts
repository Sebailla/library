import {
  MetricsService,
  METRICS_SERVICE,
  metricsServiceToken,
} from '../../src/observability/metrics.service';

/**
 * Contract tests for {@link MetricsService} — PR-N7 (issue #92).
 *
 * The service is the single owner of the prom-client registry in
 * the NAS backend. Tests pin four behaviours:
 *
 *   1. Counters and histograms exposed in the registry carry the
 *      canonical names accepted by Prometheus scrapers.
 *   2. ``recordHttpRequest(method, path, status, durationSec)``
 *      bumps the ``http_requests_total`` counter and observes the
 *      ``http_request_duration_seconds`` histogram.
 *   3. ``recordScanJob(status)`` bumps the ``scan_jobs_total``
 *      counter.
 *   4. ``recordScanJobDuration(seconds)`` observes the
 *      ``scan_job_duration_seconds`` histogram so operators can plot
 *      p50/p95 in Grafana.
 *   5. ``recordDownload(state, bytes)`` bumps the
 *      ``downloads_total`` counter by state and observes the
 *      ``download_bytes`` histogram.
 *   6. ``render()`` returns the Prometheus exposition format.
 *
 * Pure unit test: no DI graph, no HTTP. This keeps the suite under
 * a few hundred ms and pins the metric names — a refactor that
 * renames a metric would flag immediately here so dashboards do
 * not silently break.
 */
describe('MetricsService (PR-N7)', () => {
  it('exposes canonical counter and histogram names from the registered registry', async () => {
    const svc = new MetricsService();
    await svc.onApplicationBootstrap();
    const text = await svc.render();

    // Counters
    expect(text).toContain('# TYPE http_requests_total counter');
    expect(text).toContain('# TYPE scan_jobs_total counter');
    expect(text).toContain('# TYPE downloads_total counter');
    // Histograms
    expect(text).toContain('# TYPE http_request_duration_seconds histogram');
    expect(text).toContain('# TYPE scan_job_duration_seconds histogram');
    expect(text).toContain('# TYPE download_bytes histogram');
  });

  it('exports the metricsServiceToken via METRICS_SERVICE for DI usage', () => {
    expect(METRICS_SERVICE).toBe(metricsServiceToken);
  });

  it('recordHttpRequest increments the counter with method+path+status labels and observes duration', async () => {
    const svc = new MetricsService();
    await svc.onApplicationBootstrap();
    svc.recordHttpRequest('GET', '/livez', 200, 0.012);
    svc.recordHttpRequest('GET', '/livez', 200, 0.020);
    svc.recordHttpRequest('POST', '/api/auth/pair', 401, 0.030);
    const text = await svc.render();

    expect(text).toMatch(
      /http_requests_total\{method="GET",path="\/livez",status="200"\} 2/,
    );
    expect(text).toMatch(
      /http_requests_total\{method="POST",path="\/api\/auth\/pair",status="401"\} 1/,
    );
    // Buckets are exposed by the default prom-client buckets; just
    // assert the histogram received at least one observation.
    expect(text).toMatch(
      /http_request_duration_seconds_bucket\{[^}]*le="0\.05"[^}]*\} \d/u,
    );
    expect(text).toMatch(
      /http_request_duration_seconds_count\{method="GET",path="\/livez",status="200"\} 2/u,
    );
  });

  it('recordScanJob bumps scan_jobs_total by status label', async () => {
    const svc = new MetricsService();
    await svc.onApplicationBootstrap();
    svc.recordScanJob('done');
    svc.recordScanJob('done');
    svc.recordScanJob('failed');
    svc.recordScanJob('cancelled');
    const text = await svc.render();

    expect(text).toMatch(/scan_jobs_total\{status="done"\} 2/);
    expect(text).toMatch(/scan_jobs_total\{status="failed"\} 1/);
    expect(text).toMatch(/scan_jobs_total\{status="cancelled"\} 1/);
  });

  it('recordScanJobDuration observes the scan_job_duration_seconds histogram', async () => {
    const svc = new MetricsService();
    await svc.onApplicationBootstrap();
    svc.recordScanJobDuration(1.234);
    svc.recordScanJobDuration(5.678);
    const text = await svc.render();

    expect(text).toMatch(
      /scan_job_duration_seconds_bucket\{[^}]*le="5"[^}]*\} 1/u,
    );
    // Two observations: one in the le=5 bucket, the other in the
    // le=10 bucket.
    expect(text).toMatch(
      /scan_job_duration_seconds_count 2/u,
    );
  });

  it('recordDownload bumps downloads_total by state and observes download_bytes', async () => {
    const svc = new MetricsService();
    await svc.onApplicationBootstrap();
    svc.recordDownload('completed', 1024);
    svc.recordDownload('completed', 2048);
    svc.recordDownload('started', 0);
    const text = await svc.render();

    expect(text).toMatch(/downloads_total\{state="completed"\} 2/);
    expect(text).toMatch(/downloads_total\{state="started"\} 1/);
    // Both 1 KiB and 2 KiB observations should land in the le=16384
    // (16 KiB) bucket — the histogram has 8 logarithmic buckets
    // from 1 KiB to 1 GiB.
    expect(text).toMatch(
      /download_bytes_bucket\{[^}]*le="16384"[^}]*\} 2/u,
    );
    expect(text).toMatch(/download_bytes_count\{state="completed"\} 2/);
  });

  it('render() returns Prometheus exposition format (text/plain)', async () => {
    const svc = new MetricsService();
    await svc.onApplicationBootstrap();
    svc.recordHttpRequest('GET', '/health', 200, 0.001);
    const text = await svc.render();

    // At minimum, the `# HELP` and `# TYPE` headers and the
    // named-metric lines are emitted.
    expect(typeof text).toBe('string');
    expect(text).toContain('# HELP');
    expect(text).toContain('# TYPE');
    expect(text).toContain('http_requests_total{');
  });
});
