import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';

/** Async function that returns when the dependency is reachable. */
export type PingFn = () => Promise<void>;

/** Result of a single dependency check. */
export interface ComponentCheck {
  ok: boolean;
  error?: string;
}

/**
 * Body shape returned by ``GET /health``.
 *
 * On the happy path only ``status`` + ``timestamp`` + ``version`` are
 * populated. On the degraded path ``checks.{db,redis}`` identifies the
 * failing dependency so an operator can act without parsing logs.
 */
export interface HealthCheckResult {
  status: 'ok' | 'error';
  timestamp: string;
  version: string;
  checks?: {
    db: ComponentCheck;
    redis: ComponentCheck;
  };
}

/**
 * Health probe service.
 *
 * The Postgres + Redis ping functions are injected by string token so
 * e2e tests can override them without spinning up real containers.
 * Production wiring lives in ``HealthModule``.
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
