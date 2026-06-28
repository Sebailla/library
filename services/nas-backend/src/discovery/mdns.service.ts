import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import bonjour, { Bonjour, Service } from 'bonjour';

/**
 * String tokens used by {@link MdnsService} to pull its config +
 * the underlying Bonjour library from the DI graph.
 *
 * Each one is wired by a factory provider in
 * {@link DiscoveryModule} so e2e tests can override them via
 * ``Test.createTestingModule(...).overrideProvider(...)``.
 */

/** The Bonjour instance constructor (default: ``bonjour`` npm package). */
export const BONJOUR = 'NAS_BONJOUR';

/** Short name the service advertises (``alejandria-nas``). */
export const MDNS_SERVICE_NAME = 'NAS_MDNS_SERVICE_NAME';

/** Port the service advertises (HTTP port). */
export const MDNS_SERVICE_PORT = 'NAS_MDNS_SERVICE_PORT';

/** Host IP the service advertises (LAN IP). */
export const MDNS_SERVICE_HOST = 'NAS_MDNS_SERVICE_HOST';

/**
 * Bonjour wrapper shape — abstracted so the test suite can inject a
 * fake without booting a real mDNS responder on the runner.
 *
 * The wrapper extends the {@link BonjourLikeEventEmitter} subset
 * so the service can attach an ``'error'`` listener (4R review
 * #36). The real ``Bonjour`` instance from the ``bonjour`` npm
 * package is an ``EventEmitter``; the wrapper preserves the same
 * ``on``/``off``/``emit`` surface (delegating to the underlying
 * instance) so the resilience contract holds in production AND
 * in tests.
 */
export interface BonjourLikeEventEmitter {
  on(event: 'error', listener: (err: Error) => void): unknown;
  off(event: 'error', listener: (err: Error) => void): unknown;
  removeAllListeners(event?: string): unknown;
}

export interface BonjourLike extends BonjourLikeEventEmitter {
  publish(opts: {
    name: string;
    type: string;
    host?: string;
    port: number;
  }): { stop(cb?: () => void): void; published: boolean };
  destroy(): void;
}

/** Minimum subset of the ``bonjour`` factory the service depends on. */
export type BonjourFactory = () => BonjourLike;

/**
 * Default Bonjour factory — uses the real ``bonjour`` npm package.
 *
 * Production wiring uses this; e2e + unit tests inject a stub via
 * the ``BONJOUR`` token so no socket is opened on the runner.
 *
 * The wrapper exposes the underlying ``EventEmitter`` surface
 * (``on``/``off``/``removeAllListeners``) by delegating to the
 * raw bonjour instance. 4R review #36: callers attach an
 * ``'error'`` listener to swallow async UDP bind failures (EADDRINUSE,
 * EACCES when Avahi is missing) so the process does not crash.
 */
export const defaultBonjourFactory: BonjourFactory = () => {
  const instance: Bonjour = bonjour();
  // The published ``Bonjour`` type is missing ``EventEmitter``
  // methods in its d.ts; the underlying instance is in fact an
  // EventEmitter (the npm package inherits from one). Cast to the
  // structural shape we need for the error-listener delegation.
  const emitter = instance as unknown as {
    on(event: 'error', listener: (err: Error) => void): unknown;
    off(event: 'error', listener: (err: Error) => void): unknown;
    removeAllListeners(event?: string): unknown;
  };
  const wrapper: BonjourLike = {
    publish(opts) {
      const svc: Service = instance.publish({
        name: opts.name,
        type: opts.type,
        host: opts.host,
        port: opts.port,
      });
      return {
        stop: (cb?: () => void) => svc.stop(cb),
        published: svc.published,
      };
    },
    destroy() {
      instance.destroy();
    },
    on(event, listener) {
      return emitter.on(event, listener);
    },
    off(event, listener) {
      return emitter.off(event, listener);
    },
    removeAllListeners(event) {
      return emitter.removeAllListeners(event);
    },
  };
  return wrapper;
};

/**
 * mDNS service — publishes the NAS as ``_alejandria._tcp`` on the
 * configured port so LAN clients can resolve ``alejandria-nas.local``
 * without manual DNS / DHCP coordination (PR-2F, work unit 2).
 *
 * Implements {@link OnModuleInit} / {@link OnApplicationShutdown} so
 * the publish happens at boot and the Bonjour browser is closed
 * cleanly on shutdown (matters for ``jest --forceExit``).
 *
 * Publish errors are swallowed (mirrors
 * ``WorkersBootstrap.onModuleInit`` and the
 * ``nas-discovery-auth`` spec § "Errors are isolated, never
 * blocking"): the rest of the API must keep booting even when no
 * mDNS responder is available — typical on a QNAP container without
 * Avahi / Bonjour installed.
 */
@Injectable()
export class MdnsService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(MdnsService.name);
  private readonly name: string;
  private readonly port: number;
  private readonly host: string;
  private readonly bonjourInstance: BonjourLike | null;
  private service: { stop(cb?: () => void): void; published: boolean } | null =
    null;
  private started = false;

  constructor(
    @Inject(BONJOUR) bonjourOrFactory: BonjourLike | BonjourFactory,
    @Inject(MDNS_SERVICE_NAME) name: string,
    @Inject(MDNS_SERVICE_PORT) port: number,
    @Inject(MDNS_SERVICE_HOST) host: string,
  ) {
    // The token is either a ready BonjourLike (unit tests) or a
    // factory that returns one (production). Both shapes surface
    // ``publish`` / ``destroy`` so we detect which is which by
    // duck-typing the factory shape.
    if (typeof bonjourOrFactory === 'function') {
      this.bonjourInstance = bonjourOrFactory();
    } else {
      this.bonjourInstance = bonjourOrFactory;
    }
    this.name = name;
    this.port = port;
    this.host = host;
    // 4R review #36: attach an ``error`` listener on the underlying
    // bonjour instance as soon as it is available. The ``bonjour``
    // library emits ``'error'`` asynchronously when UDP bind fails
    // (EADDRINUSE on 5353, EACCES without Avahi, etc.) — without a
    // listener Node's ``EventEmitter`` re-throws and crashes the
    // process. This is the expected steady state on a QNAP container
    // without Avahi / Bonjour installed; we log + carry on instead.
    if (this.bonjourInstance) {
      this.bonjourInstance.on('error', (err: Error) => {
        this.logger.warn(
          `mDNS bonjour error (continuing without responder): ${err.message}`,
        );
      });
    }
  }

  /** The fully-qualified Bonjour name (``<name>.local``). */
  get serviceName(): string {
    return `${this.name}.local`;
  }

  async onModuleInit(): Promise<void> {
    if (this.started || !this.bonjourInstance) return;
    try {
      this.service = this.bonjourInstance.publish({
        name: this.name,
        type: '_alejandria._tcp',
        host: this.host,
        port: this.port,
      });
      this.started = true;
      this.logger.log(
        `mDNS published: ${this.serviceName} → ${this.host}:${this.port}`,
      );
    } catch (err) {
      // Mirror ``WorkersBootstrap``: do not let a missing
      // mDNS responder crash the API.
      this.logger.warn(
        `mDNS publish failed, continuing without it: ${(err as Error).message}`,
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.bonjourInstance) return;
    try {
      if (this.service) {
        await new Promise<void>((resolve) => {
          this.service!.stop(() => resolve());
        });
        this.service = null;
      }
      this.bonjourInstance.destroy();
    } catch (err) {
      this.logger.debug(
        `mDNS shutdown error (ignored): ${(err as Error).message}`,
      );
    }
  }
}
