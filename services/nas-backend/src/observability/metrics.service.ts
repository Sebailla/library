import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { Counter, Histogram, Registry } from 'prom-client';

/**
 * DI token for the project-wide {@link MetricsService}.
 *
 * Other modules SHOULD inject the service via this token (not the
 * class directly) so tests can override the implementation with a
 * stub without spinning up a real prom-client registry. Tests
 * resolve it via ``moduleRef.get(METRICS_SERVICE)`` exactly the
 * same way production wiring does.
 */
export const metricsServiceToken = 'METRICS_SERVICE';
/** Re-export under the conventional NestJS ``FooService`` alias. */
export const METRICS_SERVICE = metricsServiceToken;

/**
 * Labels attached to the HTTP request counter.
 *
 * ``method`` + ``path`` + ``status`` give operators an actionable
 * 3-axis breakdown (route × outcome). ``path`` is the Express
 * route template (e.g. ``/api/books/:book_id``) — not the raw
 * URL — so request volume for a single endpoint collapses to one
 * time series instead of one series per book_id (4R review:
 * cardinality hygiene).
 */
export type HttpRequestLabels = {
  method: string;
  path: string;
  status: string;
};

/**
 * Labels for the scan-jobs counter. The wire surface only emits
 * the terminal statuses (``done``, ``failed``, ``cancelled``) so
 * the cardinality stays at one series per status.
 */
export type ScanJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

/** Labels for the downloads counter. */
export type DownloadState = 'started' | 'completed' | 'failed';

/**
 * Single owner of the prom-client registry for the NAS backend.
 *
 * PR-N7 (issue #92) is the observability closure for the NAS
 * module graph: it exposes a ``GET /metrics`` endpoint in the
 * Prometheus exposition format, three business counters, and
 * three duration / size histograms so operators can plot
 * rate/error/duration plus a per-domain "how big is the
 * workload" signal.
 *
 * Cardinality discipline:
 *
 *   - HTTP counter is keyed by ``method + route template + status``;
 *     the middleware MUST normalise ``req.url`` to
 *     ``req.route?.path || req.path`` to avoid exploding the series
 *     count with raw paths containing book UUIDs.
 *   - Scan counter keeps ``status`` to the terminal set so the
 *     series count stays at one per status.
 *   - Download counter keeps ``state`` to the three lifecycle
 *     transitions.
 *
 * Buckets:
 *
 *   - ``http_request_duration_seconds`` uses the prom-client default
 *     buckets (``0.005s .. 10s``) — good enough for HTTP p50/p95.
 *   - ``scan_job_duration_seconds`` widens to ``0.1s .. 3600s``
 *     because full NAS scans take minutes; the default web buckets
 *     would saturate the top bucket.
 *   - ``download_bytes`` matches the file size distribution seen
 *     for the alejandria catalog (EPUBs + PDFs) — ``1KB .. 1GB``.
 */
@Injectable()
export class MetricsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MetricsService.name);
  private readonly registry = new Registry();
  private readonly httpRequestsTotal: Counter<'method' | 'path' | 'status'>;
  private readonly httpRequestDuration: Histogram<'method' | 'path' | 'status'>;
  private readonly scanJobsTotal: Counter<'status'>;
  private readonly scanJobDuration: Histogram<string>;
  private readonly downloadsTotal: Counter<'state'>;
  private readonly downloadBytes: Histogram<'state'>;

  /**
   * Allow tests to pre-instantiate the service without DI by
   * accepting an optional registry. Production wiring passes no
   * argument so we create a fresh registry per service instance.
   */
  constructor(
    @Inject(metricsServiceToken) _selfAlias?: never,
  ) {
    this.httpRequestsTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total HTTP requests handled by the NAS backend',
      labelNames: ['method', 'path', 'status'] as const,
      registers: [this.registry],
    });
    this.httpRequestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'path', 'status'] as const,
      registers: [this.registry],
    });
    this.scanJobsTotal = new Counter({
      name: 'scan_jobs_total',
      help: 'Total admin scan jobs, by terminal status',
      labelNames: ['status'] as const,
      registers: [this.registry],
    });
    this.scanJobDuration = new Histogram({
      name: 'scan_job_duration_seconds',
      help: 'Admin scan job duration in seconds, from running to terminal',
      // ``0.1s .. 3600s`` so a full-NAS scan does not saturate the
      // top bucket. Web default ``0.005s .. 10s`` would saturate.
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600, 1800, 3600],
      registers: [this.registry],
    });
    this.downloadsTotal = new Counter({
      name: 'downloads_total',
      help: 'Total downloads, by lifecycle state',
      labelNames: ['state'] as const,
      registers: [this.registry],
    });
    this.downloadBytes = new Histogram({
      name: 'download_bytes',
      help: 'Downloaded bytes per download, by lifecycle state',
      labelNames: ['state'] as const,
      // 1 KiB … 1 GiB log-spaced so a single dashboard heatmap
      // covers both small EPUBs (~500 KiB) and large PDFs (~500 MiB)
      // without saturating a single bucket.
      buckets: [
        1024,
        16 * 1024,
        256 * 1024,
        1024 * 1024,
        16 * 1024 * 1024,
        64 * 1024 * 1024,
        256 * 1024 * 1024,
        1024 * 1024 * 1024,
      ],
      registers: [this.registry],
    });
  }

  /**
   * Lifecycle hook so the NestJS container knows the service is
   * ready. The registry is created eagerly in the constructor; we
   * log a single ``onApplicationBootstrap`` line so operators can
   * confirm the module is mounted via the bootstrap log.
   */
  async onApplicationBootstrap(): Promise<void> {
    this.logger.log(
      `Prometheus registry initialised: ${(await this.registry.getMetricsAsArray()).length} metric(s) registered`,
    );
  }

  /**
   * Increment the HTTP counter and observe the duration histogram
   * in one call. The middleware MUST pass the route template
   * (``req.route?.path``) as ``path`` so a single endpoint
   * collapses to one time series.
   */
  recordHttpRequest(
    method: string,
    path: string,
    status: number,
    durationSeconds: number,
  ): void {
    const labels: HttpRequestLabels = {
      method,
      path,
      status: String(status),
    };
    this.httpRequestsTotal.inc(labels);
    this.httpRequestDuration.observe(labels, durationSeconds);
  }

  /** Increment the scan-jobs counter by terminal status. */
  recordScanJob(status: ScanJobStatus): void {
    this.scanJobsTotal.inc({ status });
  }

  /**
   * Observe the scan duration histogram. The histogram is
   * unlabelled for now (``recordScanJob`` already records the
   * status counter) — adding a ``kind`` label is a follow-up if
   * operators want to compare full vs incremental durations.
   */
  recordScanJobDuration(seconds: number): void {
    this.scanJobDuration.observe(seconds);
  }

  /** Increment the downloads counter and observe the byte histogram. */
  recordDownload(state: DownloadState, bytes: number): void {
    this.downloadsTotal.inc({ state });
    if (bytes > 0) {
      this.downloadBytes.observe({ state }, bytes);
    }
  }

  /**
   * Render the registry as the Prometheus exposition format.
   * Returned by the ``GET /metrics`` endpoint with the
   * ``text/plain; version=0.0.4`` content type registered by
   * prom-client.
   */
  render(): Promise<string> {
    return this.registry.metrics();
  }

  /**
   * Content type returned by the ``GET /metrics`` endpoint.
   * Exposed so the controller can set the response header without
   * hard-coding the string.
   */
  get contentType(): string {
    return this.registry.contentType;
  }
}
