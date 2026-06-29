import { describe, expect, it } from '@jest/globals'
import { resolve as resolvePath } from 'node:path'

import {
  sanitizePath,
  spawnSidecar,
  SidecarError,
  SPAWN_TIMEOUT_MS,
  MAX_OUTPUT_BYTES,
} from '../src'

/**
 * TDD tests for `@alejandria/sidecar` (PR-3-fix-B, issue #60).
 *
 * Two helpers are pinned here:
 *
 *   - `sanitizePath(input, { libraryRoot })` rejects empty /
 *     `-`-prefixed / `..`-escaping paths and returns the
 *     resolved absolute path on success.
 *   - `spawnSidecar(args, options)` wraps `node:child_process.spawn`
 *     with a 60 s wall-clock timeout (SIGKILL on expiry) and a
 *     64 MB per-stream stdout/stderr cap. Returns
 *     `{ exitCode, stdout, stderr }` on clean exit; rejects with
 *     `SidecarError` on overflow / timeout / non-zero exit.
 *
 * The constants `SPAWN_TIMEOUT_MS = 60_000` and
 * `MAX_OUTPUT_BYTES = 64 MiB` are also asserted directly so a
 * regression that lowers either cap is caught at the unit level
 * (4R review #45 was specifically about the values).
 */

describe('@alejandria/sidecar — constants', () => {
  it('SPAWN_TIMEOUT_MS is 60 seconds', () => {
    expect(SPAWN_TIMEOUT_MS).toBe(60_000)
  })

  it('MAX_OUTPUT_BYTES is 64 MiB', () => {
    expect(MAX_OUTPUT_BYTES).toBe(64 * 1024 * 1024)
  })
})

describe('@alejandria/sidecar — sanitizePath', () => {
  const root = resolvePath('/share/biblioteca/raw/')

  it('returns the resolved absolute path for inputs that stay inside the root', () => {
    const result = sanitizePath('sub/book.epub', { libraryRoot: root })
    expect(result).toBe(resolvePath(root, 'sub/book.epub'))
  })

  it('rejects an empty string with INVALID_PATH', () => {
    expect(() => sanitizePath('', { libraryRoot: root })).toThrow(SidecarError)
    try {
      sanitizePath('', { libraryRoot: root })
    } catch (e) {
      expect((e as SidecarError).code).toBe('INVALID_PATH')
    }
  })

  it('rejects a path starting with `-` (argv injection)', () => {
    expect(() => sanitizePath('-c', { libraryRoot: root })).toThrow(SidecarError)
    try {
      sanitizePath('-c', { libraryRoot: root })
    } catch (e) {
      expect((e as SidecarError).code).toBe('INVALID_PATH')
    }
  })

  it('rejects a `..`-escaping path', () => {
    expect(() =>
      sanitizePath('../etc/passwd', { libraryRoot: root }),
    ).toThrow(SidecarError)
    try {
      sanitizePath('../etc/passwd', { libraryRoot: root })
    } catch (e) {
      expect((e as SidecarError).code).toBe('INVALID_PATH')
    }
  })

  it('rejects an absolute path that lives outside the root', () => {
    expect(() => sanitizePath('/etc/passwd', { libraryRoot: root })).toThrow(
      SidecarError,
    )
    try {
      sanitizePath('/etc/passwd', { libraryRoot: root })
    } catch (e) {
      expect((e as SidecarError).code).toBe('INVALID_PATH')
    }
  })

  it('accepts the root itself (returns the resolved root path)', () => {
    const result = sanitizePath('.', { libraryRoot: root })
    expect(result).toBe(root)
  })
})

/**
 * The spawn-side tests build a fake `ChildProcess` so the suite
 * runs without touching `node:child_process.spawn`. The fake
 * exposes the same `stdout` / `stderr` / `error` / `exit` surface
 * `ScanProcessor` consumes in `services/nas-backend`. We model
 * the child streams as plain EventEmitters so the test stays
 * deterministic (no `Readable` internal scheduling).
 */
import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'

interface FakeStream extends EventEmitter {
  isFakeStream: true
  push(chunk: Buffer | string | null): void
}

interface FakeChild extends EventEmitter {
  stdout: FakeStream
  stderr: FakeStream
  kill: (signal?: NodeJS.Signals) => boolean
}

function makeFakeStream(): FakeStream {
  const stream = new EventEmitter() as FakeStream
  stream.isFakeStream = true
  stream.push = (chunk: Buffer | string | null): void => {
    if (chunk === null) {
      stream.emit('end')
    } else {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk
      stream.emit('data', buf)
    }
  }
  return stream
}

function makeFakeChild(): FakeChild {
  const stdout = makeFakeStream()
  const stderr = makeFakeStream()
  let killed = false
  const child = new EventEmitter() as FakeChild
  child.stdout = stdout
  child.stderr = stderr
  child.kill = (_signal?: NodeJS.Signals) => {
    killed = true
    return true
  }
  ;(child as unknown as { _killed: () => boolean })._killed = () => killed
  return child
}

describe('@alejandria/sidecar — spawnSidecar', () => {
  it('returns { exitCode, stdout, stderr } on a clean exit', async () => {
    const fake = makeFakeChild()
    const result = spawnSidecar(['python', '-c', 'print(1)'], {
      spawn: () => fake as unknown as ChildProcess,
      timeoutMs: 5_000,
      maxOutputBytes: 1024,
    })
    // Push a chunk on stdout then close + exit.
    queueMicrotask(() => {
      fake.stdout.push('hello')
      fake.stdout.push(null)
      fake.stderr.push(null)
      fake.emit('exit', 0)
    })
    await expect(result).resolves.toEqual({
      exitCode: 0,
      stdout: 'hello',
      stderr: '',
    })
  })

  it('rejects with SidecarError(OUTPUT_OVERFLOW) when stdout exceeds the cap', async () => {
    const fake = makeFakeChild()
    const result = spawnSidecar(['python', '-c', 'print(1)'], {
      spawn: () => fake as unknown as ChildProcess,
      timeoutMs: 5_000,
      maxOutputBytes: 8,
    })
    queueMicrotask(() => {
      fake.stdout.push('A'.repeat(64))
      fake.stdout.push(null)
    })
    await expect(result).rejects.toMatchObject({
      name: 'SidecarError',
      code: 'OUTPUT_OVERFLOW',
    })
  })

  it('rejects with SidecarError(SPAWN_TIMEOUT) and SIGKILLs the child on wall-clock expiry', async () => {
    const fake = makeFakeChild()
    const result = spawnSidecar(['python', '-c', 'pass'], {
      spawn: () => fake as unknown as ChildProcess,
      timeoutMs: 25,
      maxOutputBytes: 1024,
    })
    // Never emit `exit` — the timeout must fire on its own.
    await expect(result).rejects.toMatchObject({
      name: 'SidecarError',
      code: 'SPAWN_TIMEOUT',
    })
    // The helper MUST have issued SIGKILL on the child.
    expect((fake as unknown as { _killed: () => boolean })._killed()).toBe(true)
  })

  it('rejects with SidecarError(SPAWN_FAILED) when child emits `error`', async () => {
    const fake = makeFakeChild()
    const result = spawnSidecar(['python', '-c', 'pass'], {
      spawn: () => fake as unknown as ChildProcess,
      timeoutMs: 5_000,
      maxOutputBytes: 1024,
    })
    queueMicrotask(() => {
      fake.emit('error', new Error('spawn python ENOENT'))
    })
    await expect(result).rejects.toMatchObject({
      name: 'SidecarError',
      code: 'SPAWN_FAILED',
    })
  })
})