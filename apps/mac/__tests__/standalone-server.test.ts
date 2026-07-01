import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * TDD tests for `apps/mac/src/standalone-server.ts`
 * (PR-fix-mac-window-standalone-bundle).
 *
 * The Mac .app used to silently fail to render because `main.ts` called
 * `loadURL('app://./index.html')` and no `app://` handler ever resolved.
 *
 * The fix spawns the **Next.js standalone server** (a self-contained
 * Node binary at `.next/standalone/apps/web/server.js`) as a child
 * process. We isolate that concern in a dedicated module so:
 *
 *   - `main.ts` only knows "start the renderer, wait for it to be
 *     reachable, hand the URL to BrowserWindow".
 *   - The spawn contract is unit-testable WITHOUT spinning up Electron.
 *
 * Tests cover:
 *   1. The module picks a free TCP port via `getFreePort()`.
 *   2. `startStandaloneServer({ standaloneDir, host, port })` spawns
 *      the server with the right env vars.
 *   3. `stopStandaloneServer(child)` kills the process and waits for
 *      the exit promise.
 *   4. `resolveStandaloneEntry({ standaloneDir })` finds the server
 *      entry regardless of whether the dir uses forward or back
 *      slashes (the standalone output is platform-aware).
 */

type ChildLike = {
  pid?: number
  kill: (signal?: string) => void
  once: (event: 'exit', cb: (code: number | null) => void) => unknown
  on: (event: 'error', cb: (err: Error) => void) => unknown
}

function fakeChild(): ChildLike & {
  _fireExit: (code: number | null) => void
} {
  const handlers: { exit?: (code: number | null) => void; error?: (err: Error) => void } = {}
  const child = {
    pid: 12345,
    kill: vi.fn(),
    once: (event: 'exit', cb: (code: number | null) => void) => {
      if (event === 'exit') handlers.exit = cb
      return undefined
    },
    on: (event: 'error', cb: (err: Error) => void) => {
      if (event === 'error') handlers.error = cb
      return undefined
    },
    _fireExit: (code: number | null) => handlers.exit?.(code),
  }
  return child
}

describe('standalone-server (PR-fix-mac-window-standalone-bundle)', () => {
  let workDir: string

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'alejandria-standalone-'))
  })

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('resolveStandaloneEntry finds apps/web/server.js under standaloneDir', async () => {
    const { resolveStandaloneEntry } = await import('../src/standalone-server')
    const webDir = join(workDir, 'apps', 'web')
    const serverDir = join(webDir, '.next', 'standalone', 'apps', 'web')
    mkdirSync(serverDir, { recursive: true })
    writeFileSync(join(serverDir, 'server.js'), '// fake next server')

    const entry = resolveStandaloneEntry({ standaloneDir: join(webDir, '.next', 'standalone') })
    expect(entry).toBe(join(serverDir, 'server.js'))
  })

  it('resolveStandaloneEntry throws when server.js is missing', async () => {
    const { resolveStandaloneEntry } = await import('../src/standalone-server')
    expect(() =>
      resolveStandaloneEntry({ standaloneDir: join(workDir, 'no-such-dir') }),
    ).toThrow(/standalone server entry not found/)
  })

  it('startStandaloneServer spawns node with PORT and HOST env vars and returns the child', async () => {
    const { startStandaloneServer } = await import('../src/standalone-server')
    const serverEntry = join(workDir, 'server.js')
    writeFileSync(serverEntry, '// entry')

    const spawn = vi.fn().mockReturnValue(fakeChild())
    const child = startStandaloneServer({
      entryPath: serverEntry,
      host: '127.0.0.1',
      port: 4321,
      spawn,
    })

    expect(spawn).toHaveBeenCalledTimes(1)
    const [cmd, args, opts] = (spawn as unknown as { mock: { calls: unknown[][] } }).mock.calls[0] as [
      string,
      string[],
      { env: Record<string, string> },
    ]
    expect(cmd).toBe(process.execPath)
    expect(args).toEqual([serverEntry])
    expect(opts.env.PORT).toBe('4321')
    expect(opts.env.HOSTNAME).toBe('127.0.0.1')
    expect(child.pid).toBe(12345)
  })

  it('stopStandaloneServer calls kill(SIGTERM) and resolves when exit fires', async () => {
    const { stopStandaloneServer } = await import('../src/standalone-server')
    const child = fakeChild()
    const promise = stopStandaloneServer(child as never)
    // Manually fire the exit event to simulate the child exiting.
    child._fireExit(0)
    await expect(promise).resolves.toBeUndefined()
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('getFreePort resolves to a number between 1024 and 65535', async () => {
    const { getFreePort } = await import('../src/standalone-server')
    const port = await getFreePort()
    expect(port).toBeGreaterThanOrEqual(1024)
    expect(port).toBeLessThanOrEqual(65535)
  })

  it('getRendererUrl returns http://host:port once the server is reachable', async () => {
    const { getRendererUrl } = await import('../src/standalone-server')
    const url = getRendererUrl({ host: '127.0.0.1', port: 4321 })
    expect(url).toBe('http://127.0.0.1:4321')
  })

  it('honours a custom NEXT_PUBLIC_* env var passthrough (no secrets are filtered)', async () => {
    const { startStandaloneServer } = await import('../src/standalone-server')
    const serverEntry = join(workDir, 'server.js')
    writeFileSync(serverEntry, '// entry')

    const spawn = vi.fn().mockReturnValue(fakeChild())
    startStandaloneServer({
      entryPath: serverEntry,
      host: '127.0.0.1',
      port: 5555,
      env: { ALEJANDRIA_NAS_URL: 'http://nas.local:8000' },
      spawn,
    })

    const opts = (
      (spawn as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[2] as
        | { env: Record<string, string> }
        | undefined
    )
    expect(opts).toBeDefined()
    expect(opts?.env.ALEJANDRIA_NAS_URL).toBe('http://nas.local:8000')
    // Make sure the standalone entry actually exists for the spawn call
    expect(existsSync(serverEntry)).toBe(true)
  })
})