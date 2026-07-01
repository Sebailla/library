/**
 * standalone-server.ts — spawn the Next.js standalone server as a child
 * process (PR-fix-mac-window-standalone-bundle).
 *
 * Background — the Mac `.app` used to silently fail to render because
 * `main.ts` called `loadURL('app://./index.html')` and no `app://`
 * handler ever resolved. The fix is to ship the **Next.js standalone
 * server** (a self-contained Node binary at
 * `.next/standalone/apps/web/server.js`) inside the `.app` and spawn
 * it from the main process. Electron then `loadURL`s the HTTP port
 * the server is listening on.
 *
 * Why a dedicated module? Three reasons:
 *
 *   1. The spawn contract is testable WITHOUT spinning up Electron.
 *      We inject a `spawn` factory so unit tests can hand-roll a fake
 *      child and assert on env vars / argv.
 *   2. `main.ts` stays small and reads top-to-bottom: "start the
 *      renderer, wait for it to be reachable, hand the URL to
 *      BrowserWindow".
 *   3. Port-collision detection is encapsulated here. The first
 *      implementation asks the OS for a free port via `net.Server`
 *      on port 0 — collisions only matter in pathological test
 *      environments, but the contract is stable.
 *
 * The default `extraResources` mapping in `forge.config.ts` puts the
 * standalone directory at `<resourcesPath>/standalone` so the
 * packaged `.app` always finds it under the same relative path.
 */

import { createServer } from 'node:net'
import { createConnection } from 'node:net'
import { join } from 'node:path'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { spawn as defaultSpawn, type ChildProcess } from 'node:child_process'

/**
 * The path (relative to `extraResources.to`) where the standalone
 * output lands inside the `.app`. Keep in lock-step with the
 * `extraResources[0].to` field in `forge.config.ts`.
 */
const STANDALONE_RESOURCES_SUBDIR = 'standalone'

/**
 * The leaf directory name that Next.js uses for the web app in
 * the standalone output. Next.js 16 mirrors the project's cwd
 * verbatim under `.next/standalone/`, so the entry point is
 * somewhere under `<standalone>/<cwd>/apps/web/server.js` —
 * the `apps/web/` part is the same on every machine.
 */
const WEB_APP_LEAF = join('apps', 'web')

/**
 * Default host to bind the standalone server to. `127.0.0.1` is
 * enough — the renderer is a `BrowserWindow` running in the same
 * process, so we never need to accept external traffic.
 */
const DEFAULT_HOST = '127.0.0.1'

export type ChildProcessLike = ChildProcess | ReturnType<typeof defaultSpawn>

/**
 * Shape of the `spawn` factory we accept. Production code uses
 * `node:child_process.spawn`; tests pass a `vi.fn()` that returns a
 * fake child so we can assert on the env / argv without forking a
 * real process.
 */
export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv },
) => ChildProcessLike

/**
 * Resolve the absolute path to the Next.js standalone server entry
 * script.
 *
 * Next.js 16's standalone output mirrors the build's working
 * directory under `.next/standalone/`. When the build runs from
 * `apps/web/`, the entry lands at
 * `<standaloneDir>/<cwd>/apps/web/server.js` — but the `<cwd>`
 * fragment is whatever absolute path the build saw, so it can be
 * deep (`/Users/<name>/Documents/Proyectos/.../apps/web`) on
 * developer machines or shallow on CI. The `apps/web/server.js`
 * leaf is the stable piece, so we walk the standalone directory
 * looking for that leaf.
 *
 * Throws if the entry script does not exist — failing loudly is
 * the right behaviour at package time, since a missing entry means
 * the `.app` will crash on launch.
 */
export function resolveStandaloneEntry({ standaloneDir }: { standaloneDir: string }): string {
  const entry = findStandaloneEntry(standaloneDir)
  if (entry === null) {
    throw new Error(
      `standalone server entry not found under ${standaloneDir}. ` +
        'Did you forget to run "npm --prefix ../web run build:standalone"?',
    )
  }
  return entry
}

/**
 * Walk a directory tree looking for `<...>/apps/web/server.js`.
 * Returns the first match, or `null` if no entry exists.
 *
 * Bounded by the fact that `node_modules/` is huge but its
 * `server.js` files live under `next/dist/...`, NOT under
 * `apps/web/`, so the leaf-name filter naturally skips them.
 */
function findStandaloneEntry(standaloneDir: string): string | null {
  if (!existsSync(standaloneDir) || !statSync(standaloneDir).isDirectory()) {
    return null
  }

  // Shallow check first — handles the case where the build was
  // invoked from a directory whose top-level is already the web
  // app's parent (e.g. when someone runs `next build` from
  // `apps/web/` and the cwd is captured as just `apps/web`).
  const shallow = join(standaloneDir, WEB_APP_LEAF, 'server.js')
  if (existsSync(shallow) && statSync(shallow).isFile()) {
    return shallow
  }

  // Deep walk — Next.js 16 mirrors the absolute cwd, so the
  // real entry is somewhere under `<standaloneDir>/<cwd-mirror>/`.
  const stack: string[] = [standaloneDir]
  while (stack.length > 0) {
    const dir = stack.pop()
    if (dir === undefined) break
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of entries) {
      if (name === 'node_modules' || name === '.cache') continue
      const child = join(dir, name)
      let st
      try {
        st = statSync(child)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        stack.push(child)
        continue
      }
      if (st.isFile() && name === 'server.js' && dir.endsWith(WEB_APP_LEAF)) {
        return child
      }
    }
  }
  return null
}

/**
 * Spawn the standalone server. Returns the child process so the
 * caller can `kill()` it on quit. The server is bound to
 * `127.0.0.1:<port>`; the caller is responsible for waiting until
 * the port is reachable (see `waitForRenderer`).
 *
 * Environment contract:
 *   - `PORT=<port>`     — required by `next start` (Next reads this
 *                        for the listener)
 *   - `HOSTNAME=<host>` — Next.js 16 uses `HOSTNAME`, not `HOST`,
 *                        to pick the bind interface
 *   - `NODE_ENV=production` — keeps Next.js in production mode so
 *                        dev-only middleware stays out of the bundle
 *   - `process.env` is inherited so `ALEJANDRIA_NAS_URL` and
 *     friends keep working
 */
export function startStandaloneServer(params: {
  entryPath: string
  host?: string
  port: number
  env?: Record<string, string>
  spawn?: SpawnFn
}): ChildProcessLike {
  const host = params.host ?? DEFAULT_HOST
  const spawn = params.spawn ?? (defaultSpawn as unknown as SpawnFn)
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(params.port),
    HOSTNAME: host,
    NODE_ENV: process.env['NODE_ENV'] ?? 'production',
    ...(params.env ?? {}),
  }
  return spawn(process.execPath, [params.entryPath], { env })
}

/**
 * Stop the standalone server. Calls `kill('SIGTERM')` first, then
 * resolves when the child emits `exit`. We DO NOT escalate to
 * `SIGKILL` here — Next.js handles SIGTERM by closing the listener
 * cleanly, and a hard kill would race with BrowserWindow teardown.
 */
export function stopStandaloneServer(child: ChildProcessLike): Promise<void> {
  return new Promise((resolve) => {
    child.once('exit', () => resolve())
    child.kill('SIGTERM')
  })
}

/**
 * Ask the OS for a free TCP port. Binds a `net.Server` on port 0
 * (which the kernel assigns), reads the assigned port, then closes
 * the listener. There's an inherent race between close and reuse,
 * but in practice the gap is sub-millisecond and the standalone
 * server is the only thing binding that port in the .app.
 */
export function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        server.close(() => reject(new Error('failed to read assigned port')))
        return
      }
      const port = address.port
      server.close(() => resolve(port))
    })
  })
}

/**
 * Build the URL the BrowserWindow should load. In production we
 * always go through this helper so the dev / prod split lives in
 * exactly one place.
 */
export function getRendererUrl({ host, port }: { host: string; port: number }): string {
  return `http://${host}:${port}`
}

/**
 * Wait until the standalone server is reachable on the given port.
 * Polls with a 100ms backoff up to ~10s. The renderer URL is safe to
 * hand to `BrowserWindow.loadURL()` only after this resolves.
 */
export async function waitForRenderer({
  host,
  port,
  timeoutMs = 10_000,
}: {
  host: string
  port: number
  timeoutMs?: number
}): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const reachable = await isReachable(host, port)
    if (reachable) return
    await sleep(100)
  }
  throw new Error(`standalone server did not become reachable at ${host}:${port} within ${timeoutMs}ms`)
}

function isReachable(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => {
      socket.destroy()
      resolve(false)
    })
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Convenience: resolve the standalone directory inside a packaged
 * `.app`. Mirrors the `extraResources[0].to` field in
 * `forge.config.ts`. When `app.isPackaged` is false (dev), falls
 * back to the source-tree location.
 */
export function packagedStandaloneDir(resourcesPath: string): string {
  return join(resourcesPath, STANDALONE_RESOURCES_SUBDIR)
}