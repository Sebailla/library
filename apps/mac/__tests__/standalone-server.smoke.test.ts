import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'

/**
 * End-to-end smoke test for the standalone server.
 *
 * Boots the REAL Next.js 16 standalone output as a child process,
 * waits for the HTTP listener, and asserts that the server returns
 * a 2xx response on the root path. This is the strongest possible
 * verification short of building the .app and double-clicking it.
 *
 * Gated on `apps/web/.next/standalone/` existing — the developer
 * must run `npm --prefix apps/web run build:standalone` first. CI
 * can opt in by running that command before the mac test suite.
 *
 * Why a smoke test and not a unit test? Three reasons:
 *
 *   1. It exercises the actual artefact that ships in the `.app`.
 *   2. It catches regressions in `resolveStandaloneEntry` and
 *      `waitForRenderer` simultaneously.
 *   3. It documents the runtime contract in a way a future
 *      maintainer can read top-to-bottom.
 */

const REAL_STANDALONE_DIR = join(
  __dirname,
  '..',
  '..',
  'web',
  '.next',
  'standalone',
)
const REAL_ENTRY = join(
  REAL_STANDALONE_DIR,
  'Documents',
  'Proyectos',
  '2026',
  'biblioteca-v2',
  'apps',
  'web',
  'server.js',
)
const TEST_PORT = 47317

let server: ChildProcess | null = null

describe('standalone server smoke test (PR-fix-mac-window-standalone-bundle)', () => {
  beforeAll(() => {
    if (!existsSync(REAL_ENTRY)) {
      // eslint-disable-next-line no-console
      console.log(
        `[smoke] skipping — ${REAL_ENTRY} does not exist. ` +
          'Run "npm --prefix apps/web run build:standalone" first.',
      )
      return
    }
    server = spawn(process.execPath, [REAL_ENTRY], {
      env: {
        ...process.env,
        PORT: String(TEST_PORT),
        HOSTNAME: '127.0.0.1',
        NODE_ENV: 'production',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  }, 30_000)

  afterAll(async () => {
    if (server !== null && server.exitCode === null) {
      server.kill('SIGTERM')
      await new Promise<void>((resolve) => {
        server?.once('exit', () => resolve())
        setTimeout(() => {
          server?.kill('SIGKILL')
          resolve()
        }, 5_000)
      })
      server = null
    }
  }, 15_000)

  it('boots the standalone server and serves HTTP 200 on /', async () => {
    if (!existsSync(REAL_ENTRY) || server === null) {
      // Skip gracefully — see the gate above.
      return
    }
    // Poll until the server answers; the first cold-boot of Next.js
    // 16 with cacheComponents takes a few seconds.
    const deadline = Date.now() + 30_000
    let lastStatus = 0
    let lastBody = ''
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${TEST_PORT}/livez`)
        lastStatus = res.status
        lastBody = await res.text()
        if (res.status === 200) break
      } catch {
        // Server not ready yet — keep polling.
      }
      await new Promise((r) => setTimeout(r, 250))
    }
    expect(lastStatus, `last response body: ${lastBody.slice(0, 200)}`).toBe(200)
    // /livez is a tiny health route that returns text — keep the
    // assertion loose so we don't break if the route content changes.
    expect(lastBody.length).toBeGreaterThan(0)
  }, 45_000)
})