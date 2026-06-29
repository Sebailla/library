/**
 * TDD tests for `lib/sync/writer.ts` (PR-4B, #73).
 *
 * The writer is the single mutator that turns a logical
 * "save this activity" into "atomically write a JSON file
 * under the iCloud root". We test it against a fake
 * filesystem because:
 *
 *  1. Real iCloud Drive is not writable from CI.
 *  2. Real mtime resolution on most filesystems is coarse
 *     (1 second on FAT, milliseconds on APFS) so a unit
 *     test cannot reliably assert "mtime advances".
 *  3. We want the test to be deterministic; passing our
 *     own `now()` and `writeFile()` lets us assert
 *     identical outputs without `vi.useFakeTimers`.
 *
 * Out-of-scope behaviour the writer MUST have that these
 * tests check:
 *   - Files end up at `<icloudDir>/<category>/<bookId>.json`
 *   - JSON shape is exactly `SyncFile` (version, bookId,
 *     category, updatedAt, payload).
 *   - `updatedAt` defaults to the writer's `now`, not the
 *     OS clock.
 *   - The parent directory is created if absent.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest'

import type { SyncFile, SyncFs, Note } from '../types'
import { writeSyncFile } from '../writer'

class MemoryFs implements SyncFs {
  files = new Map<string, string>()
  dirs = new Set<string>()
  statMtime = 1

  async readdir(dir: string): Promise<string[]> {
    return [...this.dirs].filter((d) => d.startsWith(`${dir}/`))
  }

  async readFile(path: string): Promise<string> {
    const v = this.files.get(path)
    if (v === undefined) throw new Error(`ENOENT: ${path}`)
    return v
  }

  async writeFile(path: string, contents: string): Promise<void> {
    this.files.set(path, contents)
  }

  async unlink(path: string): Promise<void> {
    this.files.delete(path)
  }

  async mkdir(path: string): Promise<void> {
    this.dirs.add(path)
  }

  async stat(path: string): Promise<{ mtimeMs: number }> {
    if (!this.files.has(path)) throw new Error(`ENOENT: ${path}`)
    return { mtimeMs: this.statMtime }
  }
}

const makeNote = (overrides: Partial<{ id: string; text: string }> = {}) => ({
  id: overrides.id ?? 'n-1',
  bookId: 'book-1',
  locator: 'cfi=100',
  text: overrides.text ?? 'annotation text',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

describe('sync/writer (PR-4B, #73)', () => {
  let fs: MemoryFs

  const ICLOUD = '/tmp/alejandria'

  beforeEach(() => {
    fs = new MemoryFs()
  })

  it('writes a SyncFile at <icloudDir>/<category>/<bookId>.json', async () => {
    await writeSyncFile(
      { fs, icloudDir: ICLOUD, category: 'notes', bookId: 'book-1', payload: makeNote(), now: () => '2026-06-01T10:00:00.000Z' },
    )
    const expected = '/tmp/alejandria/notes/book-1.json'
    expect(fs.files.has(expected)).toBe(true)
  })

  it('serializes the SyncFile envelope with the writer-supplied updatedAt', async () => {
    await writeSyncFile(
      { fs, icloudDir: ICLOUD, category: 'notes', bookId: 'b', payload: makeNote({ text: 'hi' }), now: () => '2026-06-29T12:00:00.000Z' },
    )
    const raw = fs.files.get('/tmp/alejandria/notes/b.json')!
    const parsed = JSON.parse(raw) as SyncFile
    expect(parsed.version).toBe(1)
    expect(parsed.bookId).toBe('b')
    expect(parsed.category).toBe('notes')
    expect(parsed.updatedAt).toBe('2026-06-29T12:00:00.000Z')
    // The writer trusts the payload's own `bookId`; the
    // outer `bookId` is for the file path, the inner one
    // travels with the data.
    expect(parsed.payload).toEqual({
      id: 'n-1',
      bookId: 'book-1',
      locator: 'cfi=100',
      text: 'hi',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
  })

  it('creates the category directory if it does not exist', async () => {
    await writeSyncFile(
      { fs, icloudDir: ICLOUD, category: 'highlights', bookId: 'b', payload: { id: 'h-1', bookId: 'b', locator: 'cfi=1', text: 'h', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }, now: () => '2026-06-29T12:00:00.000Z' },
    )
    expect(fs.dirs.has('/tmp/alejandria/highlights')).toBe(true)
  })

  it('overwrites an existing file in place', async () => {
    await writeSyncFile(
      { fs, icloudDir: ICLOUD, category: 'notes', bookId: 'b', payload: makeNote({ text: 'v1' }), now: () => '2026-06-01T00:00:00.000Z' },
    )
    await writeSyncFile(
      { fs, icloudDir: ICLOUD, category: 'notes', bookId: 'b', payload: makeNote({ text: 'v2' }), now: () => '2026-06-02T00:00:00.000Z' },
    )
    const parsed = JSON.parse(
      fs.files.get('/tmp/alejandria/notes/b.json')!,
    ) as SyncFile & { payload: Note }
    expect(parsed.payload.text).toBe('v2')
    expect(parsed.updatedAt).toBe('2026-06-02T00:00:00.000Z')
  })
})
