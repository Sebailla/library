# @alejandria/sidecar

Shared spawn + path sanitization for the `alejandria-sidecar` process
boundary. Extracted from `services/nas-backend/src/workers/scan.processor.ts`
during PR-3-fix-B so the web-side scan pipeline (`apps/web/lib/scan/local-pipeline.ts`)
and the BullMQ scan processor share the exact same hardening.

## Exports

| Symbol | Purpose |
|--------|---------|
| `sanitizePath(input, { libraryRoot })` | Rejects empty / `-`-prefixed / `..`-escaping paths. Returns the resolved absolute path. |
| `spawnSidecar(args, options)` | Spawns a sidecar child process with a 60 s wall-clock timeout (SIGKILL on expiry) and a 64 MB stdout+stderr cap. Returns `{ exitCode, stdout, stderr }` or throws `SidecarError`. |
| `SPAWN_TIMEOUT_MS`, `MAX_OUTPUT_BYTES` | Constants the spawn helper uses (60 000 ms, 64 MiB). |
| `SidecarError` | Typed error with `code`, `exitCode`, `stderr`, and `envelope` fields. |

See `src/sidecar-process.ts` for the implementation and
`src/index.ts` for the public surface.