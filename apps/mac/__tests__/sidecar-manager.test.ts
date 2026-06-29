import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

/**
 * TDD tests for `src/sidecar-manager.ts` (PR-4C, issue #75).
 *
 * The sidecar manager is the lifecycle owner for the Python
 * sidecar process. Requirements:
 *   - Lazy start: no Python child is spawned until the first
 *     `getProcess()` call.
 *   - Single child: subsequent `getProcess()` calls return the
 *     same handle (the sidecar is stateful — restarting on every
 *     scan would lose its in-memory cache).
 *   - Clean teardown: `kill()` MUST send SIGTERM and resolve
 *     promptly so Electron's `before-quit` handler can call it.
 *   - `kill()` is idempotent: calling it twice does not throw.
 *   - Construction accepts an injection seam so tests don't have
 *     to mock `node:child_process` globally.
 */

interface FakeChild {
  pid: number
  killed: boolean
  signal: string | null
  kill: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  once: ReturnType<typeof vi.fn>
  emit: (event: string, ...args: unknown[]) => boolean
}

function makeFakeChild(pid: number): FakeChild {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>()
  const child: FakeChild = {
    pid,
    killed: false,
    signal: null,
    kill: vi.fn((sig: string) => {
      child.killed = true
      child.signal = sig
      return true
    }),
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      const arr = listeners.get(event) ?? []
      arr.push(cb)
      listeners.set(event, arr)
      return child
    }),
    once: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      const arr = listeners.get(event) ?? []
      arr.push(cb)
      listeners.set(event, arr)
      return child
    }),
    emit(event, ...args) {
      const arr = listeners.get(event) ?? []
      for (const cb of arr) cb(...args)
      return arr.length > 0
    },
  }
  return child
}

describe('sidecar-manager (PR-4C)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not spawn anything at construction time (lazy start)', async () => {
    const { SidecarManager } = await import('../src/sidecar-manager')
    const spawn = vi.fn()

    const mgr = new SidecarManager({ command: 'python', args: ['-m', 'sidecar'], spawn })
    expect(spawn).not.toHaveBeenCalled()
    // No need to actually run a teardown — nothing was spawned.
    void mgr
  })

  it('spawns the sidecar on the first getProcess() call and reuses the same child', async () => {
    const { SidecarManager } = await import('../src/sidecar-manager')
    const fake = makeFakeChild(4242)
    const spawn = vi.fn(() => fake)

    const mgr = new SidecarManager({ command: 'python', args: ['-m', 'sidecar'], spawn })
    const first = await mgr.getProcess()
    const second = await mgr.getProcess()

    expect(spawn).toHaveBeenCalledTimes(1)
    expect(spawn).toHaveBeenCalledWith('python', ['-m', 'sidecar'])
    expect(first).toBe(fake)
    expect(second).toBe(fake)
  })

  it('kill() sends SIGTERM to the child and resolves', async () => {
    const { SidecarManager } = await import('../src/sidecar-manager')
    const fake = makeFakeChild(7777)
    const spawn = vi.fn(() => fake)

    const mgr = new SidecarManager({ command: 'python', args: ['-m', 'sidecar'], spawn })
    await mgr.getProcess()

    const killPromise = mgr.kill()
    expect(fake.kill).toHaveBeenCalledWith('SIGTERM')
    await killPromise
  })

  it('kill() is idempotent — calling it twice does not throw', async () => {
    const { SidecarManager } = await import('../src/sidecar-manager')
    const fake = makeFakeChild(8888)
    const spawn = vi.fn(() => fake)

    const mgr = new SidecarManager({ command: 'python', args: ['-m', 'sidecar'], spawn })
    await mgr.getProcess()

    await mgr.kill()
    // Second call MUST also resolve without throwing even though
    // the child is already gone.
    await expect(mgr.kill()).resolves.toBeUndefined()
  })

  it('kill() before any getProcess() call is a no-op', async () => {
    const { SidecarManager } = await import('../src/sidecar-manager')
    const spawn = vi.fn()

    const mgr = new SidecarManager({ command: 'python', args: ['-m', 'sidecar'], spawn })
    await expect(mgr.kill()).resolves.toBeUndefined()
    expect(spawn).not.toHaveBeenCalled()
  })

  it('force-kills the child with SIGKILL if it has not exited within 5s', async () => {
    const { SidecarManager } = await import('../src/sidecar-manager')
    const fake = makeFakeChild(9999)
    // kill() does not actually exit the child in this fake, so the
    // manager MUST escalate to SIGKILL after the grace period.
    const spawn = vi.fn(() => fake)

    const mgr = new SidecarManager({ command: 'python', args: ['-m', 'sidecar'], spawn })
    await mgr.getProcess()

    const killPromise = mgr.kill()
    // First signal: SIGTERM
    expect(fake.kill).toHaveBeenLastCalledWith('SIGTERM')

    // Advance past the 5s grace period
    await vi.advanceTimersByTimeAsync(5_000)

    // Escalation: SIGKILL
    expect(fake.kill).toHaveBeenLastCalledWith('SIGKILL')
    await killPromise
  })
})
