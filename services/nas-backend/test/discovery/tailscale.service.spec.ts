import { Test } from '@nestjs/testing';
import {
  TAILSCALE_SHELL,
  TailscaleService,
} from '../../src/discovery/tailscale.service';

/**
 * Contract tests for {@link TailscaleService} (PR-2F, work unit 3).
 *
 * The service shells out to the ``tailscale`` CLI (``tailscale ip -4``)
 * to detect the host's Tailscale IPv4 address. When ``tailscale`` is
 * not installed OR not running, the service MUST return ``null`` so
 * the discovery endpoint can surface the "Tailscale down" state to
 * clients (see nas-discovery-auth spec § "Tailscale discovery
 * fallback").
 *
 * The actual subprocess call is injected via the ``TAILSCALE_SHELL``
 * string token so tests never spawn a real process on the runner.
 *
 * Contract:
 *
 *   - returns the trimmed stdout when the command succeeds
 *   - returns ``null`` when the command fails (non-zero exit,
 *     stderr-only output, or thrown error)
 *   - never throws — callers depend on the graceful ``null`` path
 */
class FakeShell {
  constructor(
    private readonly stdout: string,
    private readonly code: number = 0,
  ) {}
  async run(cmd: string): Promise<{ stdout: string; stderr: string; code: number }> {
    if (!cmd.includes('tailscale')) {
      throw new Error(`unexpected command: ${cmd}`);
    }
    return { stdout: this.stdout, stderr: '', code: this.code };
  }
}

async function buildService(shell: FakeShell): Promise<TailscaleService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      TailscaleService,
      {
        provide: TAILSCALE_SHELL,
        useValue: shell,
      },
    ],
  }).compile();
  return moduleRef.get(TailscaleService);
}

describe('TailscaleService', () => {
  it('returns the trimmed IPv4 string when tailscale is up', async () => {
    const service = await buildService(
      new FakeShell('100.64.0.5\n', 0),
    );
    const ip = await service.getIp();
    expect(ip).toBe('100.64.0.5');
  });

  it('handles stdout without trailing newline', async () => {
    const service = await buildService(new FakeShell('100.64.0.5', 0));
    expect(await service.getIp()).toBe('100.64.0.5');
  });

  it('returns null when tailscale is not installed (non-zero exit)', async () => {
    const service = await buildService(
      new FakeShell('', 127), // 127 = command not found
    );
    expect(await service.getIp()).toBeNull();
  });

  it('returns null when tailscale is installed but not running', async () => {
    const service = await buildService(
      new FakeShell('', 1), // tailscaled down → exit 1
    );
    expect(await service.getIp()).toBeNull();
  });

  it('returns null when stdout is empty even on success (auth required, no state)', async () => {
    const service = await buildService(new FakeShell('', 0));
    expect(await service.getIp()).toBeNull();
  });

  it('returns null when the shell call throws (defensive path)', async () => {
    class ThrowingShell {
      async run(): Promise<never> {
        throw new Error('ENOSPC');
      }
    }
    const service = await buildService(
      new ThrowingShell() as unknown as FakeShell,
    );
    expect(await service.getIp()).toBeNull();
  });

  it('invokes the shell with `tailscale ip -4`', async () => {
    let capturedCmd = '';
    class CapturingShell {
      async run(cmd: string): Promise<{ stdout: string; stderr: string; code: number }> {
        capturedCmd = cmd;
        return { stdout: '100.64.0.5\n', stderr: '', code: 0 };
      }
    }
    const service = await buildService(
      new CapturingShell() as unknown as FakeShell,
    );
    await service.getIp();
    expect(capturedCmd).toBe('tailscale ip -4');
  });
});
