import { ScanEventBus } from '../../../src/admin/scan/scan-event-bus';
import { ScanProgressEvent } from '../../../src/admin/scan/scan.types';

/**
 * Contract tests for {@link ScanEventBus} (PR-N4).
 *
 * The bus wraps a Node ``EventEmitter`` so the SSE controller can
 * subscribe per-job and the BullMQ worker can publish progress
 * ticks without a shared mutable list. The contract:
 *
 *   - ``publish`` synchronously delivers to every subscriber of
 *     the given jobId.
 *   - Subscribers that join AFTER ``publish`` MUST NOT see the
 *     past event (no replay).
 *   - Multiple subscribers on the same jobId all receive the
 *     event.
 *   - Subscribers on different jobIds are isolated.
 *   - ``unsubscribe`` removes a subscriber so subsequent publishes
 *     do not deliver to it.
 */

describe('ScanEventBus', () => {
  it('delivers a published event to the matching jobId subscriber', () => {
    const bus = new ScanEventBus();
    const events: ScanProgressEvent[] = [];
    bus.subscribe('job-1', (e) => events.push(e));
    const ev: ScanProgressEvent = {
      jobId: 'job-1',
      type: 'progress',
      processed: 1,
      total: 10,
      timestamp: '2026-06-29T12:00:00Z',
    };
    bus.publish('job-1', ev);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(ev);
  });

  it('does NOT replay past events to a late subscriber', () => {
    const bus = new ScanEventBus();
    bus.publish('job-1', {
      jobId: 'job-1',
      type: 'progress',
      processed: 1,
      total: 10,
      timestamp: 't0',
    });
    const events: ScanProgressEvent[] = [];
    bus.subscribe('job-1', (e) => events.push(e));
    expect(events).toHaveLength(0);
  });

  it('delivers the same event to every subscriber on the same jobId', () => {
    const bus = new ScanEventBus();
    const a: ScanProgressEvent[] = [];
    const b: ScanProgressEvent[] = [];
    bus.subscribe('job-1', (e) => a.push(e));
    bus.subscribe('job-1', (e) => b.push(e));
    bus.publish('job-1', {
      jobId: 'job-1',
      type: 'progress',
      processed: 1,
      total: 10,
      timestamp: 't0',
    });
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it('isolates subscribers across different jobIds', () => {
    const bus = new ScanEventBus();
    const a: ScanProgressEvent[] = [];
    const b: ScanProgressEvent[] = [];
    bus.subscribe('job-1', (e) => a.push(e));
    bus.subscribe('job-2', (e) => b.push(e));
    bus.publish('job-1', {
      jobId: 'job-1',
      type: 'progress',
      processed: 1,
      total: 10,
      timestamp: 't0',
    });
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(0);
  });

  it('unsubscribe removes the subscriber from the jobId topic', () => {
    const bus = new ScanEventBus();
    const events: ScanProgressEvent[] = [];
    const unsub = bus.subscribe('job-1', (e) => events.push(e));
    unsub();
    bus.publish('job-1', {
      jobId: 'job-1',
      type: 'progress',
      processed: 1,
      total: 10,
      timestamp: 't0',
    });
    expect(events).toHaveLength(0);
  });
});