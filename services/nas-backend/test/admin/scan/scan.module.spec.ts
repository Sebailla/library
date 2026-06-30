// Producer-side import (the worker wiring's canonical factory
// is re-exported from ``workers.module.ts`` for back-compat;
// the producer-side helper lives next to the rest of the BullMQ
// plumbing in ``bullmq.config.ts`` so the admin scan module can
// import it without dragging in the workers module).
import {
  buildQueueOptions,
} from '../../../src/workers/workers.module';
import {
  getScanProducerDefaultJobOptions,
} from '../../../src/workers/bullmq.config';

/**
 * Issue #98 — collapse the BullMQ retry literal duplication.
 *
 * The producer ``defaultJobOptions`` inside ``scan.module.ts``
 * (lines 97-102) repeats the same four retry values that
 * {@link buildQueueOptions} already exposes:
 *
 *   - ``attempts: 3``
 *   - ``backoff: { type: 'exponential', delay: 5000 }``
 *   - ``removeOnComplete: { age: 3600, count: 1000 }``
 *   - ``removeOnFail: { age: 86400 }``
 *
 * A typo on either side silently desyncs the producer's
 * retry budget from the worker's. The contract pinned here is
 * that the producer's options MUST be byte-identical to the
 * worker's canonical {@link buildQueueOptions} value — sharing
 * one factory, not two.
 */

describe('scan.module producer defaultJobOptions (issue #98)', () => {
  it('equals buildQueueOptions() byte-identically (no duplicated retry literals)', () => {
    // The helper is the single seam between scan.module.ts and
    // buildQueueOptions(); both the producer's useFactory AND the
    // test reach the value through the same function so the
    // assertions always observe the same struct as production.
    expect(getScanProducerDefaultJobOptions()).toEqual(buildQueueOptions());
  });

  it('shares every retry value the worker queue options pin', () => {
    const producer = getScanProducerDefaultJobOptions();
    const worker = buildQueueOptions();
    // The shared values are the four retry knobs both sides
    // touch: attempts + backoff (retry budget) and
    // removeOnComplete + removeOnFail (retention). A drift on
    // any one of them is the bug we're guarding against.
    expect(producer.attempts).toBe(worker.attempts);
    expect(producer.backoff).toEqual(worker.backoff);
    expect(producer.removeOnComplete).toEqual(worker.removeOnComplete);
    expect(producer.removeOnFail).toEqual(worker.removeOnFail);
  });
});
