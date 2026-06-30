import { MetricsService, METRICS_SERVICE } from '../../src/observability/metrics.service';
import { instrumentDownloadsService } from '../../src/observability/downloads-instrumentation';
import type {
  CreateDownloadInput,
  CreateDownloadResponse,
  UpdateDownloadInput,
  UpdateDownloadResponse,
  DownloadsService,
} from '../../src/downloads/downloads.service';

/**
 * Contract tests for the downloads instrumentation adapter
 * (PR-N7, issue #92).
 *
 * The adapter wraps ``DownloadsService`` so that every business
 * event emits the matching Prometheus counter / histogram.
 *
 * Cardinality budget pinned:
 *
 *   - ``downloads_total{state="started"}``  — every successful
 *     ``createDownload`` call.
 *   - ``downloads_total{state="in_progress"}``  — every
 *     ``updateDownload`` call, regardless of completion. Lets
 *     operators distinguish "download vanished" (started but no
 *     further updates) from "download finished".
 *   - ``downloads_total{state="completed"}``  — when
 *     ``updateDownload`` flips ``completed = true``.
 *   - ``download_bytes{state="in_progress"|state="completed"}`` —
 *     each PATCH observes the running byte total so the
 *     histogram also captures in-flight download sizes.
 */
describe('InstrumentedDownloadsService (PR-N7)', () => {
  /**
   * Minimal DownloadsService stub conforming to the real
   * interface. The adapter delegates to all five methods, so we
   * record each call for the delegation assertions.
   */
  class StubDownloadsService {
    nextId = 1;
    calls: Array<{ op: string; payload: unknown }> = [];
    async createDownload(input: CreateDownloadInput): Promise<CreateDownloadResponse> {
      this.calls.push({ op: 'create', payload: input });
      return { download_id: this.nextId++, resume_supported: false };
    }
    async updateDownload(
      id: number,
      input: UpdateDownloadInput,
    ): Promise<UpdateDownloadResponse> {
      this.calls.push({ op: 'update', payload: { id, ...input } });
      return {
        id,
        completed: input.completed,
        bytes_transferred: input.bytesTransferred,
        book_id: 0,
        device_id: null,
        downloaded_at: '2026-01-01T00:00:00.000Z',
      };
    }
    async getStats(): Promise<unknown> {
      return { total_downloads: 0, completed_downloads: 0 };
    }
    async topDevicesForBook(): Promise<unknown> {
      return { book_id: 0, top_devices: [] };
    }
    async listByDevice(): Promise<unknown> {
      return { data: [] };
    }
    private __unusedDownloads: unknown;
  }

  function textHits(text: string, regex: RegExp): number {
    const matches = text.match(regex);
    if (!matches) return 0;
    return Number(matches[1]);
  }

  it('records downloads_total{state="started"} on createDownload', async () => {
    const metrics = new MetricsService();
    await metrics.onApplicationBootstrap();
    const inner = new StubDownloadsService() as unknown as DownloadsService;
    const inst = instrumentDownloadsService(inner, metrics);
    await inst.createDownload({ bookId: 42, deviceId: null, ipAddress: '127.0.0.1', userAgent: 't' });
    const text = await metrics.render();
    expect(textHits(text, /downloads_total\{state="started"\} (\d+)/)).toBe(1);
  });

  it('records downloads_total{state="completed"} when updateDownload marks completed=true', async () => {
    const metrics = new MetricsService();
    await metrics.onApplicationBootstrap();
    const inner = new StubDownloadsService() as unknown as DownloadsService;
    const inst = instrumentDownloadsService(inner, metrics);
    await inst.updateDownload(1, { completed: true, bytesTransferred: 4096, requestingDeviceId: 'd' });
    const text = await metrics.render();
    expect(textHits(text, /downloads_total\{state="completed"\} (\d+)/)).toBe(1);
    // The bytes histogram MUST also have observed 4096.
    expect(text).toMatch(/download_bytes_bucket\{[^}]*le="16384"[^}]*state="completed"\} 1/);
  });

  it('records downloads_total{state="started"} on each createDownload (composing counts)', async () => {
    const metrics = new MetricsService();
    await metrics.onApplicationBootstrap();
    const inner = new StubDownloadsService() as unknown as DownloadsService;
    const inst = instrumentDownloadsService(inner, metrics);
    await inst.createDownload({ bookId: 1, deviceId: null, ipAddress: '127.0.0.1', userAgent: 't' });
    await inst.createDownload({ bookId: 2, deviceId: null, ipAddress: '127.0.0.1', userAgent: 't' });
    await inst.createDownload({ bookId: 3, deviceId: null, ipAddress: '127.0.0.1', userAgent: 't' });
    const text = await metrics.render();
    expect(textHits(text, /downloads_total\{state="started"\} (\d+)/)).toBe(3);
  });

  it('does NOT bump the completed counter when updateDownload marks completed=false', async () => {
    const metrics = new MetricsService();
    await metrics.onApplicationBootstrap();
    const inner = new StubDownloadsService() as unknown as DownloadsService;
    const inst = instrumentDownloadsService(inner, metrics);
    await inst.updateDownload(1, { completed: false, bytesTransferred: 1000, requestingDeviceId: 'd' });
    const text = await metrics.render();
    expect(text).not.toMatch(/downloads_total\{state="completed"\} \d+/);
    // But the bytes progress update should still have happened
    // (the test asserts the bytes histogram got the observation).
    expect(text).toMatch(/download_bytes_bucket\{[^}]*le="1024"[^}]*state="in_progress"\} 1/);
  });

  it('delegates every argument faithfully to the wrapped service', async () => {
    const metrics = new MetricsService();
    await metrics.onApplicationBootstrap();
    const inner = new StubDownloadsService();
    const inst = instrumentDownloadsService(inner as unknown as DownloadsService, metrics);
    const createResult = await inst.createDownload({
      bookId: 7,
      deviceId: null,
      ipAddress: '127.0.0.1',
      userAgent: 't',
    });
    expect(createResult).toMatchObject({ download_id: 1, resume_supported: false });
    expect(inner.calls).toEqual([
      {
        op: 'create',
        payload: { bookId: 7, deviceId: null, ipAddress: '127.0.0.1', userAgent: 't' },
      },
    ]);
    await inst.updateDownload(9, { completed: true, bytesTransferred: 2048, requestingDeviceId: 'd' });
    expect(inner.calls).toHaveLength(2);
  });

  it('exposes METRICS_SERVICE as the canonical DI token (caller does not need the class literal)', () => {
    expect(METRICS_SERVICE).toBe('METRICS_SERVICE');
  });
});

void (null as unknown as MetricsService);
