/**
 * Sidecar lifecycle manager for the `@alejandria/mac` Electron
 * shell (PR-4C, issue #75).
 *
 * The Python sidecar (`python -m alejandria_sidecar …`) is
 * stateful — it caches the OS file tree between scans so the
 * second invocation is much cheaper than the first. Spawning a
 * fresh child for every `scan()` IPC call would defeat that
 * cache. So this manager:
 *
 *   1. Spawns lazily on the first `getProcess()` call.
 *   2. Reuses the same child for every subsequent call.
 *   3. Sends `SIGTERM` on `kill()` and escalates to `SIGKILL`
 *      after a 5 s grace period (the same policy as the NAS-side
 *      scan worker in `services/nas-backend/src/workers/scan.processor.ts`).
 *   4. Stays idempotent: a second `kill()` is a no-op.
 *
 * The `spawn` factory is injected as a constructor option so unit
 * tests can drive the manager with a fake `ChildProcess` and
 * avoid touching `node:child_process` at all.
 */

import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'

/**
 * Factory shape compatible with `node:child_process.spawn`
 * (`command, args → ChildProcess`). Exposed as a type alias so
 * tests can pass a `vi.fn()` without resorting to `as any`.
 */
export type SpawnFactory = (command: string, args: readonly string[]) => ChildProcess

export interface SidecarManagerOptions {
  /** Sidecar executable (default: `'python'`). */
  command?: string
  /** Sidecar argv. The factory prepends the `command` for you. */
  args?: readonly string[]
  /** Inject a custom spawn factory (test seam). */
  spawn?: SpawnFactory
  /**
   * Grace period in ms between SIGTERM and SIGKILL (default
   * 5 000). Matches the NAS-side scan worker policy.
   */
  killGraceMs?: number
}

/**
 * Owns the sidecar `ChildProcess` and exposes a single
 * `getProcess()` accessor plus a `kill()` teardown.
 */
export class SidecarManager {
  readonly #command: string
  readonly #args: readonly string[]
  readonly #spawn: SpawnFactory
  readonly #killGraceMs: number
  #child: ChildProcess | null = null
  #killPromise: Promise<void> | null = null

  constructor(options: SidecarManagerOptions = {}) {
    this.#command = options.command ?? 'python'
    this.#args = options.args ?? ['-m', 'alejandria_sidecar']
    this.#spawn = options.spawn ?? (nodeSpawn as unknown as SpawnFactory)
    this.#killGraceMs = options.killGraceMs ?? 5_000
  }

  /**
   * Return the sidecar child, spawning it on the first call.
   * Subsequent calls return the same handle so the sidecar's
   * in-memory cache survives across scans.
   */
  getProcess(): Promise<ChildProcess> {
    if (this.#child !== null) {
      return Promise.resolve(this.#child)
    }
    if (this.#killPromise !== null) {
      // A kill is already in flight — refuse to spawn a new
      // child against a process that's about to die. Callers
      // should construct a fresh manager after a teardown.
      return Promise.reject(
        new Error('SidecarManager: cannot getProcess() while a kill() is in progress'),
      )
    }
    const child = this.#spawn(this.#command, this.#args)
    this.#child = child
    // If the child exits on its own (crash, natural completion),
    // clear the cached handle so the next getProcess() respawns.
    child.once('exit', () => {
      if (this.#child === child) {
        this.#child = null
      }
    })
    return Promise.resolve(child)
  }

  /**
   * Send SIGTERM to the child and escalate to SIGKILL after the
   * grace period. Idempotent — a second call is a no-op. Safe to
   * call before `getProcess()` (does nothing in that case).
   *
   * Resolution rules:
   *   - If the child emits `exit` before the grace period
   *     elapses, the promise resolves immediately (graceful
   *     shutdown).
   *   - If the grace period elapses without an `exit`, the
   *     manager escalates to SIGKILL and resolves the promise
   *     then (forced shutdown). The caller does not have to
   *     wait for the kernel to reap the process.
   */
  kill(): Promise<void> {
    if (this.#killPromise !== null) {
      return this.#killPromise
    }
    const child = this.#child
    if (child === null) {
      return Promise.resolve()
    }
    this.#killPromise = new Promise<void>((resolve) => {
      let settled = false
      const settle = (): void => {
        if (settled) return
        settled = true
        clearTimeout(escalateTimer)
        resolve()
      }
      child.once('exit', settle)
      let escalateTimer: ReturnType<typeof setTimeout>
      try {
        child.kill('SIGTERM')
      } catch {
        // child.kill throws if the handle is already dead — treat
        // that as a successful exit.
        settle()
        return
      }
      escalateTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          /* already gone */
        }
        settle()
      }, this.#killGraceMs)
      // Don't keep the event loop alive just for the escalation
      // timer — Electron is shutting down.
      if (typeof (escalateTimer as { unref?: () => void }).unref === 'function') {
        ;(escalateTimer as { unref: () => void }).unref()
      }
    })
    // Clear the cached handle immediately so concurrent callers
    // don't try to use a dying child.
    this.#child = null
    return this.#killPromise
  }
}
