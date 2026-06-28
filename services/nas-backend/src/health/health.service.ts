import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';

/** Async function that returns when the dependency is reachable. */
export type PingFn = () => Promise<void>;

/** Result of a single dependency check. */
export interface ComponentCheck {
  ok: boolean;
  error?: string;
}

/**
 * Body shape returned by the health probes.
 *
 * On the happy path only ``status`` + ``timestamp`` + ``version`` are
 * populated. On the degraded path ``checks.{db,redis}`` identifies
 * the failing dependency so an operator can act without parsing
 * logs.
 */
export interface HealthCheckResult {
  status: 'ok' | 'error';
  timestamp: string;
  version: string;
  checks?: {
    db: ComponentCheck;
    redis?: ComponentCheck;
  };
}

/**
 * Health probe service.
 *
 * The Postgres + Redis ping functions are injected by string token so
 * e2e tests can override them without spinning up real containers.
 * Production wiring lives in ``HealthModule``.
 *
 * 4R review #38 split the original ``GET /health`` into three
 * probes aligned with the k8s liveness / readiness pattern:
 *
 *   - {@link HealthService.liveness} — process is up. Returns
 *     200 unconditionally; never touches a dependency. A
 *     transient Redis blip MUST NOT restart the pod.
 *   - {@link HealthService.readiness} — primary dependency
 *     (Postgres) is reachable. Redis-down stays 200 because the
 *     HTTP layer is fully functional on Postgres alone — only
 *     the BullMQ workers require Redis, and they self-disable
 *     when the broker is unreachable.
 *   - {@link HealthService.check} — verbose diagnostic that
 *     reports BOTH dependencies so operators can pinpoint the
 *     failing component (preserved for ``GET /health``).
 */
@Injectable()
export class HealthService {
  private readonly version: string;

  constructor(
    @Inject('DATABASE_PING') private readonly dbPing: PingFn,
    @Inject('REDIS_PING') private readonly redisPing: PingFn,
  ) {
    // package.json's ``version`` is the single source of truth.
    this.version = process.env.APP_VERSION ?? '0.1.0';
  }

  /**
   * Liveness probe — returns 200 if the process is up.
   *
   * NEVER touches a dependency. The probe's whole purpose is to
   * tell the orchestrator "the JS process is alive, do NOT
   * restart it" — so it cannot itself depend on Postgres or
   * Redis being reachable.
   */
  async liveness(): Promise<HealthCheckResult> {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: this.version,
    };
  }

  /**
   * Readiness probe — returns 200 if Postgres is reachable.
   *
   * Redis-down stays 200 because the HTTP layer is fully
   * functional on Postgres alone. The check is intentionally
   * Postgres-only; a failing Redis surfaces via
   * ``GET /health`` for operators who need to see it.
   */
  async readiness(): Promise<HealthCheckResult> {
    const db = await this.safePing(this.dbPing);
    if (db.ok) {
      return {
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: this.version,
      };
    }
    throw new ServiceUnavailableException({
      status: 'error',
      timestamp: new Date().toISOString(),
      version: this.version,
      checks: { db },
    });
  }

  /**
   * Verbose diagnostic — returns 200 only when BOTH Postgres
   * and Redis are reachable, 503 otherwise with per-check
   * detail. Preserved as ``GET /health`` for the
   * "what's actually down" operator use case.
   */
  async check(): Promise<HealthCheckResult> {
    const db = await this.safePing(this.dbPing);
    const redis = await this.safePing(this.redisPing);
    const allOk = db.ok && redis.ok;

    if (allOk) {
      return {
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: this.version,
      };
    }

    // Throwing ``ServiceUnavailableException`` makes NestJS return a
    // 503 response with the exception's payload as the body, which is
    // exactly the shape the e2e spec asserts.
    throw new ServiceUnavailableException({
      status: 'error',
      timestamp: new Date().toISOString(),
      version: this.version,
      checks: { db, redis },
    });
  }

  private async safePing(fn: PingFn): Promise<ComponentCheck> {
    try {
      await fn();
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  }
}
