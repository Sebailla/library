import { EventEmitter } from 'events';
import { ScanProgressEvent } from './scan.types';

/**
 * Unsubscribe handle returned by {@link ScanEventBus.subscribe}.
 * Calling it removes the listener from the underlying topic so
 * subsequent ``publish`` calls do not deliver to it.
 */
export type Unsubscribe = () => void;

/**
 * Scan progress event bus — PR-N4.
 *
 * Wraps a Node ``EventEmitter`` so the SSE controller can
 * subscribe per-job and the BullMQ worker can publish progress
 * ticks without a shared mutable list.
 *
 * Topic key is the job UUID. The bus is intentionally
 * not-a-replay-log: a subscriber that joins AFTER ``publish``
 * MUST NOT see past events. Operators that need a replay log can
 * read the ``scan_jobs`` row directly — the bus is the live
 * progress channel, not the audit trail.
 *
 * The class is registered as a NestJS provider (``@Injectable()``)
 * so the controller and the BullMQ producer share a single
 * instance across the app. The default ``EventEmitter`` cap of
 * 10 listeners per topic is more than enough for the admin UI
 * (typically one open SSE tab per scan).
 */
export class ScanEventBus {
  private readonly emitter = new EventEmitter();

  /**
   * Subscribe to progress events for a single job. Returns an
   * unsubscribe handle so the SSE controller can detach the
   * listener when the client disconnects.
   */
  subscribe(jobId: string, listener: (event: ScanProgressEvent) => void): Unsubscribe {
    this.emitter.on(jobId, listener);
    return () => this.emitter.off(jobId, listener);
  }

  /**
   * Publish a progress event to every subscriber of the job's
   * topic. Synchronous — listeners run on the same tick as the
   * publish call so the SSE ``res.write`` happens immediately.
   */
  publish(jobId: string, event: ScanProgressEvent): void {
    this.emitter.emit(jobId, event);
  }
}