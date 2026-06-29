/**
 * Default sync engine factory (PR-4B, issue #73).
 *
 * Wires the production collaborators:
 *
 *   - real `node:fs/promises` filesystem;
 *   - macOS chokidar watcher (delegates to `./watcher`);
 *   - the default LWW conflict resolver;
 *   - a JSON decoder that accepts the v1 envelope and
 *     rejects anything else (so a corrupt file in
 *     iCloud Drive does not poison the index).
 *
 * The factory exists so app code never has to assemble
 * these deps itself. Tests that need control over any of
 * them go through `createSyncEngine` with explicit deps.
 */

import fs from 'node:fs/promises'

import { getICloudDir } from './path'
import { createWatcher } from './watcher'
import { defaultResolveConflict } from './conflict-resolver'
import { createSyncEngine, type SyncEngine } from './sync-engine'
import type { SyncFile } from './types'

/**
 * Decode + validate a raw JSON value as a v1 `SyncFile`.
 * Anything that is not a v1 envelope is rejected — we
 * would rather lose a single annotation than crash the
 * whole engine on a malformed file.
 */
function defaultDecode(raw: unknown): SyncFile | null {
  if (typeof raw !== 'object' || raw === null) return null
  const candidate = raw as Partial<SyncFile>
  if (candidate.version !== 1) return null
  if (typeof candidate.bookId !== 'string') return null
  if (typeof candidate.category !== 'string') return null
  if (typeof candidate.updatedAt !== 'string') return null
  if (typeof candidate.payload !== 'object' || candidate.payload === null) {
    return null
  }
  return candidate as SyncFile
}

/**
 * Build the production-ready engine.
 *
 * `icloudDir` overrides the default (env-aware) iCloud
 * directory; pass nothing to honor `ALEJANDRIA_ICLOUD_DIR`
 * or fall back to the macOS default.
 */
export function createDefaultEngine(
  icloudDir: string = getICloudDir(),
): SyncEngine {
  const watcher = createWatcher({
    icloudDir,
    stat: async (path: string) => {
      const s = await fs.stat(path)
      return { mtimeMs: s.mtimeMs }
    },
  })
  return createSyncEngine({
    icloudDir,
    fs: {
      readdir: (dir) => fs.readdir(dir),
      readFile: (p) => fs.readFile(p, 'utf8'),
      writeFile: async (p, c) => {
        await fs.writeFile(p, c, 'utf8')
      },
      unlink: (p) => fs.unlink(p),
      mkdir: async (p, opts) => {
        await fs.mkdir(p, opts as { recursive?: boolean })
      },
      stat: async (p) => {
        const s = await fs.stat(p)
        return { mtimeMs: s.mtimeMs }
      },
    },
    watcher,
    decode: defaultDecode,
    resolveConflict: defaultResolveConflict,
  })
}
