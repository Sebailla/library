import { Test } from '@nestjs/testing';
import { EventEmitter } from 'events';
import {
  BONJOUR,
  MDNS_SERVICE_HOST,
  MDNS_SERVICE_NAME,
  MDNS_SERVICE_PORT,
  MdnsService,
  defaultBonjourFactory,
} from '../../src/discovery/mdns.service';

/**
 * Contract tests for {@link MdnsService} (PR-2F, work unit 2).
 *
 * The service publishes the NAS as ``_alejandria._tcp`` on port
 * 3000 via Bonjour so LAN clients (Mac, iPad, other machines) can
 * resolve ``alejandria-nas.local`` without manual DNS or DHCP
 * coordination. Tests inject the underlying ``bonjour`` library
 * via a string token so we never open a real mDNS responder on
 * the test runner.
 *
 * Contract:
 *
 *   - ``onModuleInit`` publishes the service with the configured
 *     name (``alejandria-nas``) + HTTP port + the host IP.
 *   - ``onApplicationShutdown`` unpublishes (closes the bonjour
 *     browser) so Jest can exit cleanly.
 *   - ``serviceName`` returns the FQDN Bonjour advertises
 *     (``<name>.local``).
 */
class FakeBrowser {
  published: Array<{ name: string; port: number; host?: string }> = [];
  closed = false;
  stopped = false;
  publish(spec: { name: string; port: number; host?: string }): unknown {
    this.published.push(spec);
    return this;
  }
  stop(cb?: () => void): void {
    this.stopped = true;
    if (cb) cb();
  }
  unpublishAll(): void {
    /* no-op */
  }
  destroy(): void {
    this.closed = true;
  }
}

class FakeBonjour {
  browsers: FakeBrowser[] = [];
  constructor(private readonly factory: () => FakeBrowser) {}
  publish(opts: { name?: string; port?: number; host?: string }): FakeBrowser {
    const browser = this.factory();
    browser.publish({
      name: opts.name ?? '',
      port: opts.port ?? 0,
      host: opts.host,
    });
    this.browsers.push(browser);
    return browser;
  }
  destroy(): void {
    for (const b of this.browsers) b.destroy();
  }
}

function buildFakeBonjour(): {
  bonjour: FakeBonjour;
  browsers: FakeBrowser[];
} {
  const browsers: FakeBrowser[] = [];
  const bonjour = new FakeBonjour(() => {
    const browser = new FakeBrowser();
    browsers.push(browser);
    return browser;
  });
  return { bonjour, browsers };
}

async function buildService(opts: {
  bonjour: FakeBonjour;
  name: string;
  port: number;
  host: string;
}): Promise<MdnsService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      MdnsService,
      {
        provide: BONJOUR,
        useValue: opts.bonjour,
      },
      {
        provide: MDNS_SERVICE_NAME,
        useValue: opts.name,
      },
      {
        provide: MDNS_SERVICE_PORT,
        useValue: opts.port,
      },
      {
        provide: MDNS_SERVICE_HOST,
        useValue: opts.host,
      },
    ],
  }).compile();
  return moduleRef.get(MdnsService);
}

describe('MdnsService', () => {
  it('publishes _alejandria._tcp on port 3000 with the configured name', async () => {
    const { bonjour, browsers } = buildFakeBonjour();
    const service = await buildService({
      bonjour,
      name: 'alejandria-nas',
      port: 3000,
      host: '192.168.1.50',
    });
    await service.onModuleInit();
    expect(browsers).toHaveLength(1);
    expect(browsers[0].published).toEqual([
      { name: 'alejandria-nas', port: 3000, host: '192.168.1.50' },
    ]);
  });

  it('exposes the FQDN as <name>.local', async () => {
    const { bonjour } = buildFakeBonjour();
    const service = await buildService({
      bonjour,
      name: 'alejandria-nas',
      port: 3000,
      host: '192.168.1.50',
    });
    await service.onModuleInit();
    expect(service.serviceName).toBe('alejandria-nas.local');
  });

  it('shuts the bonjour browser down on onApplicationShutdown', async () => {
    const { bonjour, browsers } = buildFakeBonjour();
    const service = await buildService({
      bonjour,
      name: 'alejandria-nas',
      port: 3000,
      host: '192.168.1.50',
    });
    await service.onModuleInit();
    await service.onApplicationShutdown();
    expect(browsers[0].closed).toBe(true);
  });

  it('swallows publish errors so the rest of the app keeps booting', async () => {
    // A bonjour implementation that throws on publish — must NOT
    // bubble (per spec nas-discovery-auth § "Errors are isolated,
    // never blocking", mirrored from the workers module).
    class ThrowingBonjour {
      publish(): unknown {
        throw new Error('mdns responder unavailable');
      }
    }
    const service = await buildService({
      bonjour: new ThrowingBonjour() as unknown as FakeBonjour,
      name: 'alejandria-nas',
      port: 3000,
      host: '192.168.1.50',
    });
    await expect(service.onModuleInit()).resolves.toBeUndefined();
    // Service name is still queryable even when the publish failed.
    expect(service.serviceName).toBe('alejandria-nas.local');
  });
});

/**
 * Resilience contract — 4R review #36.
 *
 * ``bonjour`` emits ``'error'`` asynchronously when UDP bind fails
 * (EADDRINUSE on 5353, EACCES without Avahi, etc.). The expected
 * steady state on a QNAP container without Avahi / Bonjour is
 * exactly this error. With no listener attached, Node's
 * ``EventEmitter`` throws and the process crashes.
 *
 * The fix attaches a listener on the bonjour instance as soon as
 * the factory instantiates it, so the error becomes a logged
 * warning instead of a crash.
 */
describe('MdnsService bonjour error listener (#36)', () => {
  /**
   * Bonjour shape with an ``EventEmitter`` surface so the error
   * listener can be attached and the test can ``emit('error')``
   * deterministically.
   */
  class EmittingBonjour extends EventEmitter {
    published: Array<{ name: string; port: number; host?: string }> = [];
    publish(opts: { name?: string; port?: number; host?: string }): unknown {
      this.published.push({
        name: opts.name ?? '',
        port: opts.port ?? 0,
        host: opts.host,
      });
      return this;
    }
    destroy(): void {
      this.removeAllListeners();
    }
    stop(_cb?: () => void): void {
      /* no-op */
    }
    unpublishAll(): void {
      /* no-op */
    }
  }

  it('attaches an error listener on the bonjour instance (no unhandled error crash)', async () => {
    const bonjour = new EmittingBonjour();
    const service = await buildService({
      bonjour: bonjour as unknown as FakeBonjour,
      name: 'alejandria-nas',
      port: 3000,
      host: '192.168.1.50',
    });
    await service.onModuleInit();
    // The service must have at least one ``error`` listener on the
    // underlying bonjour instance; otherwise an async ``emit('error')``
    // would re-throw inside Node and crash the process.
    expect(bonjour.listenerCount('error')).toBeGreaterThanOrEqual(1);
    // Emitting must not throw — the listener swallows + logs.
    expect(() => bonjour.emit('error', new Error('EADDRINUSE 0.0.0.0:5353')))
      .not.toThrow();
  });

  it('attaches an error listener even when the bonjour instance is passed via a factory function', async () => {
    const bonjour = new EmittingBonjour();
    const factory = (): FakeBonjour => bonjour as unknown as FakeBonjour;
    const moduleRef = await Test.createTestingModule({
      providers: [
        MdnsService,
        { provide: BONJOUR, useValue: factory },
        { provide: MDNS_SERVICE_NAME, useValue: 'alejandria-nas' },
        { provide: MDNS_SERVICE_PORT, useValue: 3000 },
        { provide: MDNS_SERVICE_HOST, useValue: '192.168.1.50' },
      ],
    }).compile();
    const service = moduleRef.get(MdnsService);
    await service.onModuleInit();
    // Same expectation: the factory-path also wires the listener.
    expect(bonjour.listenerCount('error')).toBeGreaterThanOrEqual(1);
    expect(() => bonjour.emit('error', new Error('EACCES bind 5353')))
      .not.toThrow();
  });
});
