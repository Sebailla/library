/**
 * Public surface for `@alejandria/sidecar`.
 *
 * The shared spawn + path-sanitization helpers live here so both
 * the web scan pipeline (`apps/web/lib/scan/local-pipeline.ts`)
 * and the BullMQ scan processor
 * (`services/nas-backend/src/workers/scan.processor.ts`) use the
 * exact same hardening.
 *
 * PR-3-fix-B closes issue #60 by extracting the PR-2E hardening
 * into this package — without the extraction the web-side spawn
 * re-opens the argv-injection / unbounded-stdout / hung-Python
 * failure modes PR-2E closed on the NAS side.
 */
export {
  sanitizePath,
  spawnSidecar,
  SidecarError,
  SPAWN_TIMEOUT_MS,
  MAX_OUTPUT_BYTES,
  type SanitizePathOptions,
  type SpawnSidecarOptions,
  type SpawnSidecarResult,
  type SpawnSidecarImpl,
} from './sidecar-process'