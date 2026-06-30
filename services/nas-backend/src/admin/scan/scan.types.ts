/**
 * Domain types for the admin scan surface — PR-N4.
 *
 * The HTTP layer, the BullMQ producer, and the cooperative
 * cancellation worker all speak the same in-process shapes
 * defined here. The controller maps wire-format (snake_case) to
 * these camelCase types; the repository stores them as their
 * ``scan_jobs`` row equivalent.
 *
 * The SSE stream publishes {@link ScanProgressEvent}s. The event
 * bus wrapper (``scan-event-bus.ts``) multiplexes them onto a
 * per-job topic so a single client can subscribe to one job's
 * progress without leaking events for other jobs.
 */

/**
 * Shape of a row in the ``scan_jobs`` table.
 *
 * ``id`` is the UUID the iPad client generated when it enqueued
 * the request; the server never re-mints it. ``libraryId`` is
 * nullable so a future "scan every library" variant can leave it
 * ``null`` without breaking the FK contract. ``status`` matches
 * the DB-level CHECK constraint. ``cancelled`` is the cooperative
 * cancel flag — the worker checks it between files; it is
 * independent of ``status`` so a cancel request can flip the flag
 * without forcing a transition away from ``running``.
 *
 * ``totalFiles`` is ``null`` until the worker finishes walking
 * ``library.root_path``; SSE consumers should treat ``null`` as
 * "still counting". ``processedFiles`` is the running counter
 * the SSE stream publishes on every file. ``startedAt`` /
 * ``finishedAt`` are nullable because a job that has not been
 * picked up yet has neither.
 *
 * ``error`` carries the worker failure message when ``status =
 * 'failed'``; every other status has it as ``null``.
 */
export interface ScanJob {
  id: string;
  libraryId: number | null;
  kind: ScanJobKind;
  status: ScanJobStatus;
  startedAt: Date | null;
  finishedAt: Date | null;
  totalFiles: number | null;
  processedFiles: number;
  cancelled: boolean;
  error: string | null;
}

/** Discriminator for the two scan flavours PR-N4 ships. */
export type ScanJobKind = 'full' | 'incremental';

/**
 * Lifecycle state of a scan job.
 *
 *   - ``queued``     — enqueued, no worker has picked it up yet.
 *   - ``running``    — a worker is processing it (the cancel flag
 *                      may also be set).
 *   - ``done``       — terminal success.
 *   - ``cancelled``  — terminal: the cancel flag was observed by
 *                      the worker between two files.
 *   - ``failed``     — terminal: an unrecoverable error occurred
 *                      (see ``error`` for the diagnostic).
 */
export type ScanJobStatus =
  | 'queued'
  | 'running'
  | 'done'
  | 'cancelled'
  | 'failed';

/**
 * Subset of {@link ScanJob} accepted by
 * {@link ScanRepository.insertJob}. ``libraryId`` and ``kind`` are
 * the only caller-supplied fields; everything else is filled by
 * the worker or the repository defaults. The server-generated
 * UUID is the caller's responsibility — the spec lets the client
 * mint the id so it can reconcile the response without a
 * round-trip.
 */
export interface NewScanJob {
  id: string;
  libraryId: number | null;
  kind: ScanJobKind;
}

/**
 * SSE event payload emitted by the scan event bus.
 *
 * The event is sent as a JSON-encoded ``data:`` line on the SSE
 * stream. ``type`` discriminates between progress ticks and
 * terminal events so the client can switch on it without
 * inspecting the presence of every optional field.
 *
 *   - ``type: 'progress'`` — emitted between files; ``processed``
 *     carries the latest counter (and ``total`` if the worker has
 *     finished walking the root path).
 *   - ``type: 'done'``     — emitted when the worker completes the
 *     last file successfully.
 *   - ``type: 'cancelled'``— emitted when the worker observes the
 *     ``cancelled`` flag between two files.
 *   - ``type: 'failed'``   — emitted when the worker hits an
 *     unrecoverable error; ``error`` carries the diagnostic.
 *
 * ``jobId`` is echoed on every event so a stream multiplexer can
 * filter without parsing the payload.
 */
export interface ScanProgressEvent {
  jobId: string;
  type: 'progress' | 'done' | 'cancelled' | 'failed';
  processed: number;
  total: number | null;
  error?: string;
  timestamp: string;
}