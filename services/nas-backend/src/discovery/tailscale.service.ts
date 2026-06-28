import { Inject, Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';

/**
 * String token used by {@link TailscaleService} to pull its
 * subprocess call from the DI graph. The default provider in
 * {@link DiscoveryModule} uses Node's ``child_process.execFile``;
 * e2e tests inject a stub via
 * ``Test.createTestingModule(...).overrideProvider(...)``.
 */
export const TAILSCALE_SHELL = 'NAS_TAILSCALE_SHELL';

/** Minimum interface the service needs from a subprocess runner. */
export interface ShellLike {
  run(
    cmd: string,
    args: readonly string[],
  ): Promise<{ stdout: string; stderr: string; code: number }>;
}

const execFileAsync = promisify(execFile);

/**
 * Default subprocess runner — shells out to ``tailscale ip -4``
 * with a short timeout. The command is fixed (no user input) so
 * ``execFile`` is safe; no shell interpreter is involved.
 */
export const defaultShell: ShellLike = {
  async run(cmd, args) {
    try {
      const { stdout, stderr } = await execFileAsync(cmd, args, {
        timeout: 1500,
        windowsHide: true,
      });
      return { stdout: stdout ?? '', stderr: stderr ?? '', code: 0 };
    } catch (err) {
      const e = err as NodeJS.ErrnoException & {
        stdout?: string;
        stderr?: string;
        code?: string | number;
      };
      // ``execFile`` rejects on non-zero exit. The shape mirrors
      // the success path so the caller can inspect stdout even
      // when the binary printed the answer and exited non-zero.
      const exitCode =
        typeof e.code === 'number'
          ? e.code
          : Number.parseInt(String(e.code ?? ''), 10) || 1;
      return {
        stdout: e.stdout ?? '',
        stderr: e.stderr ?? '',
        code: Number.isFinite(exitCode) ? exitCode : 1,
      };
    }
  },
};

/**
 * Tailscale probe service (PR-2F, work unit 3).
 *
 * Shells out to the ``tailscale`` CLI and reports the host's
 * Tailscale IPv4 address. The CLI is the official source of truth:
 * it talks to the local ``tailscaled`` daemon over its Unix socket /
 * Windows named pipe and returns the address the tailnet has
 * assigned to this machine.
 *
 * Behaviour:
 *
 *   - ``tailscale up`` is running → return the trimmed stdout of
 *     ``tailscale ip -4``.
 *   - ``tailscale`` binary not installed (exit 127 / ENOENT) →
 *     return ``null``. Operator sees "Tailscale down" in the
 *     discovery endpoint and on the admin UI.
 *   - ``tailscaled`` daemon stopped (exit 1) → ``null``.
 *   - The subprocess call throws / times out → ``null``.
 *
 * The service MUST NOT throw: ``DiscoveryService.getInfo`` depends
 * on the graceful ``null`` path so the endpoint can still answer
 * while Tailscale is unavailable.
 */
@Injectable()
export class TailscaleService {
  private readonly logger = new Logger(TailscaleService.name);

  constructor(
    @Inject(TAILSCALE_SHELL) private readonly shell: ShellLike,
  ) {}

  /**
   * Resolve the host's Tailscale IPv4 or return ``null`` when the
   * CLI is missing / the daemon is down / the call times out.
   */
  async getIp(): Promise<string | null> {
    try {
      const { stdout, code } = await this.shell.run('tailscale', ['ip', '-4']);
      if (code !== 0) return null;
      const trimmed = stdout.trim();
      return trimmed === '' ? null : trimmed;
    } catch (err) {
      this.logger.debug(
        `tailscale probe error (returning null): ${(err as Error).message}`,
      );
      return null;
    }
  }
}
