/**
 * iCloud Drive directory resolution (PR-4B, issue #73).
 *
 * Apple Books stores user activity under
 *   ~/Library/Mobile Documents/com~apple~cloudDocs/Books/
 * We follow the same convention but route it to our own
 * subdirectory so the user's iCloud Drive stays tidy:
 *   ~/Library/Mobile Documents/com~apple~cloudDocs/Alejandria/
 *
 * On non-macOS dev machines (Linux CI, Windows laptops
 * used to write tests) the path above obviously does not
 * resolve, so we honor an explicit environment override:
 *
 *   ALEJANDRIA_ICLOUD_DIR=/tmp/alejandria-icloud
 *
 * Any non-empty string turns the env override on. The
 * override is read lazily on every call (rather than
 * once at module load) so a developer can flip it
 * between two `npm test` runs without restarting the
 * process — and so tests can stub it per-test.
 */

import os from 'node:os'
import path from 'node:path'

/**
 * The conventional Apple iCloud Drive root inside the
 * user's macOS home directory. Exported so other modules
 * (tests, the writer, the watcher) can join it without
 * re-typing the string.
 */
export const APPLE_ICLOUD_DRIVE_SUBDIR =
  'Library/Mobile Documents/com~apple~cloudDocs'

/** The namespace inside iCloud Drive that alejandria owns. */
export const ALEJANDRIA_ICLOUD_NAMESPACE = 'Alejandria'

/**
 * Environment variable consulted before falling back to
 * the macOS default. Honors a single global toggle.
 */
export const ICLOUD_DIR_ENV = 'ALEJANDRIA_ICLOUD_DIR'

/**
 * Returns the resolved iCloud directory to use for sync
 * files. Order of precedence:
 *
 *   1. Process env `ALEJANDRIA_ICLOUD_DIR` if non-empty.
 *      (Lets non-macOS devs and CI use a tmp dir.)
 *   2. macOS default under the current user's home.
 *
 * We intentionally collapse to an absolute path so the
 * caller never has to think about relative vs absolute —
 * chokidar expects absolute paths and so does the
 * conflict resolver when it compares mtimes.
 */
export function getICloudDir(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
): string {
  const override = env[ICLOUD_DIR_ENV]
  if (typeof override === 'string' && override.length > 0) {
    return path.resolve(override)
  }
  return path.join(homedir(), APPLE_ICLOUD_DRIVE_SUBDIR, ALEJANDRIA_ICLOUD_NAMESPACE)
}

/**
 * Builds the absolute path of a per-category, per-book
 * sync file. The convention is:
 *
 *   <icloudDir>/<category>/<bookId>.json
 *
 * Centralizing the filename here means the writer, the
 * watcher, and the conflict resolver cannot disagree on
 * what file a given activity lives in.
 */
export function getSyncFilePath(
  icloudDir: string,
  category: string,
  bookId: string,
): string {
  // Normalize slashes on Windows so `path.join` does not
  // emit mixed separators; on macOS this is a no-op.
  return path.join(icloudDir, category, `${bookId}.json`)
}
