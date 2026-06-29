/**
 * TDD tests for `lib/sync/path.ts` (PR-4B, #73).
 *
 * `getICloudDir` is the single seam between the engine
 * and the macOS file layout. Two behaviours matter:
 *
 *  1. Env override wins when `ALEJANDRIA_ICLOUD_DIR` is
 *     non-empty. The override is what lets Linux CI
 *     and Windows laptops point at a tmp dir without
 *     instantiating Apple iCloud Drive.
 *  2. macOS default joins the conventional Apple path
 *     (`Library/Mobile Documents/com~apple~cloudDocs`)
 *     with our `Alejandria` namespace.
 *
 * `getSyncFilePath` derives a deterministic
 * `<category>/<bookId>.json` filename under the chosen
 * root. The writer, watcher, and resolver all have to
 * agree on that filename — if they don't, we silently
 * lose edits.
 */

import { describe, expect, it } from 'vitest'
import path from 'node:path'

import {
  APPLE_ICLOUD_DRIVE_SUBDIR,
  ALEJANDRIA_ICLOUD_NAMESPACE,
  ICLOUD_DIR_ENV,
  getICloudDir,
  getSyncFilePath,
} from '../path'

const HOMEDIR = '/Users/alice'

describe('sync/path (PR-4B, #73)', () => {
  it('returns the env override when ALEJANDRIA_ICLOUD_DIR is set', () => {
    const env = { [ICLOUD_DIR_ENV]: '/tmp/alejandria-test' }
    expect(getICloudDir(env, () => HOMEDIR)).toBe(
      path.resolve('/tmp/alejandria-test'),
    )
  })

  it('joins relative env override onto cwd', () => {
    // A relative path should still resolve to absolute so
    // chokidar and the engine never operate on cwd-relative
    // paths (those are a class of bugs we do not want).
    const env = { [ICLOUD_DIR_ENV]: 'alejandria-test' }
    expect(getICloudDir(env, () => HOMEDIR)).toBe(
      path.resolve('alejandria-test'),
    )
  })

  it('falls back to the macOS default under homedir when env is unset', () => {
    const env: Record<string, string | undefined> = {}
    expect(getICloudDir(env, () => HOMEDIR)).toBe(
      path.join(
        HOMEDIR,
        APPLE_ICLOUD_DRIVE_SUBDIR,
        ALEJANDRIA_ICLOUD_NAMESPACE,
      ),
    )
  })

  it('falls back to the macOS default when env is set to an empty string', () => {
    // An empty override is indistinguishable from "no
    // override" — Apple Books's own shell treats them the
    // same, so we do too.
    const env = { [ICLOUD_DIR_ENV]: '' }
    expect(getICloudDir(env, () => HOMEDIR)).toBe(
      path.join(
        HOMEDIR,
        APPLE_ICLOUD_DRIVE_SUBDIR,
        ALEJANDRIA_ICLOUD_NAMESPACE,
      ),
    )
  })

  it('builds the per-category, per-book sync file path', () => {
    const icloudDir = path.join(HOMEDIR, 'icloud')
    const filePath = getSyncFilePath(icloudDir, 'notes', 'book-123')
    expect(filePath).toBe(path.join(icloudDir, 'notes', 'book-123.json'))
  })

  it('uses one .json file per book in each category folder', () => {
    const icloudDir = '/tmp/alejandria'
    expect(getSyncFilePath(icloudDir, 'highlights', 'a')).toBe(
      '/tmp/alejandria/highlights/a.json',
    )
    expect(getSyncFilePath(icloudDir, 'bookmarks', 'a')).toBe(
      '/tmp/alejandria/bookmarks/a.json',
    )
    expect(getSyncFilePath(icloudDir, 'progress', 'a')).toBe(
      '/tmp/alejandria/progress/a.json',
    )
  })
})
