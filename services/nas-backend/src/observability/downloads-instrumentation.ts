import type { DownloadsService } from '../downloads/downloads.service';
import type {
  CreateDownloadInput,
  CreateDownloadResponse,
  UpdateDownloadInput,
  UpdateDownloadResponse,
  TopDevicesForBookResponse,
  ListByDeviceResponse,
} from '../downloads/downloads.service';
import type { DownloadStats } from '../downloads/downloads.repository';
import type { MetricsService } from './metrics.service';

/**
 * DI token for the metric-instrumented downloads service.
 *
 * Issue #99 — controllers inject this token (NOT
 * {@link MetricsService} directly) so the "which states fire
 * which counters" decision lives in ONE place
 * ({@link instrumentDownloadsService}). Wiring this token in
 * ``DownloadsModule`` finally turns the otherwise-dead
 * ``instrumentDownloadsService`` factory into the single
 * public surface for download metrics.
 */
export const INSTRUMENTED_DOWNLOADS_SERVICE = 'INSTRUMENTED_DOWNLOADS_SERVICE';

/**
 * Surface implemented by {@link instrumentDownloadsService}. The
 * adapter mirrors {@link DownloadsService} so call sites swap one
 * for the other with no signature changes.
 *
 * The type is structural (interface only) so the existing
 * ``DownloadsService`` class remains the single source of truth
 * for the wire shapes — the adapter delegates everything except
 * the metric hooks.
 */
export interface InstrumentedDownloadsService {
  createDownload(input: CreateDownloadInput): Promise<CreateDownloadResponse>;
  updateDownload(id: number, input: UpdateDownloadInput): Promise<UpdateDownloadResponse>;
  getStats(): Promise<DownloadStats>;
  topDevicesForBook(
    bookId: number,
    limit?: number,
  ): Promise<TopDevicesForBookResponse>;
  listByDevice(deviceId: string): Promise<ListByDeviceResponse>;
}

/**
 * Wrap a {@link DownloadsService} so each business event bumps
 * the Prometheus counters / histograms declared by
 * {@link MetricsService}.
 *
 * Cardinality discipline: the adapter accepts the typed
 * ``DownloadsService`` directly (not a fake interface) so a
 * future add to the contract is caught at compile time instead
 * of silently dropping a metric.
 *
 * The adapter is the ONLY call site for
 * ``MetricsService.recordDownload`` — controllers, workers and
 * tests go through here. This keeps the "which states fire
 * which metrics" decision in ONE place.
 *
 * Issue #99 — failure series. ``createDownload`` and
 * ``updateDownload`` both flow through a ``try/catch`` that
 * records ``downloads_total{state=\"failed\"}`` on throw and
 * re-throws so the controller layer can shape the HTTP error
 * envelope. Without this branch the failure rate is permanently
 * zero in dashboards.
 */
export function instrumentDownloadsService(
  inner: DownloadsService,
  metrics: Pick<MetricsService, 'recordDownload'>,
): InstrumentedDownloadsService {
  return {
    async createDownload(input) {
      metrics.recordDownload('started', 0);
      try {
        return await inner.createDownload(input);
      } catch (err) {
        // Bytes are unknown on the create path (the row never landed),
        // so we observe the histogram at 0 — cardinality is unchanged.
        metrics.recordDownload('failed', 0);
        throw err;
      }
    },
    async updateDownload(id, input) {
      // The byte observation is recorded UNCONDITIONALLY so
      // operators see ongoing downloads even if the PATCH never
      // flips ``completed = true`` (e.g. flaky client connection).
      metrics.recordDownload('in_progress', input.bytesTransferred);
      if (input.completed) {
        metrics.recordDownload('completed', input.bytesTransferred);
      }
      try {
        return await inner.updateDownload(id, input);
      } catch (err) {
        // Observe the bytes the client had reported so dashboards
        // can show "downloads that failed mid-flight were on average
        // X KiB in" instead of a dimensionless 0.
        metrics.recordDownload('failed', input.bytesTransferred);
        throw err;
      }
    },
    async getStats() {
      return inner.getStats();
    },
    async topDevicesForBook(bookId, limit) {
      return inner.topDevicesForBook(bookId, limit);
    },
    async listByDevice(deviceId) {
      return inner.listByDevice(deviceId);
    },
  };
}
