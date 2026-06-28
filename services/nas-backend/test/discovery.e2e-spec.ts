import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DEVICES_REPOSITORY } from '../src/auth/devices.repository';
import {
  LAN_IPS,
  MDNS_NAME,
} from '../src/discovery/discovery.service';
import { TAILSCALE_SHELL } from '../src/discovery/tailscale.service';

/**
 * End-to-end contract tests for ``GET /api/discovery/info`` (PR-2F,
 * work unit 1).
 *
 * The discovery endpoint lets LAN clients (Mac, iPad, other machines)
 * discover the NAS without manual IP configuration. It returns the
 * mDNS service name we publish, the HTTP port the API listens on, the
 * Tailscale IP if Tailscale is up, and the LAN IPs of the host.
 *
 * Contract:
 *
 *   200 OK   {
 *     mdns_name:    "alejandria-nas.local",
 *     port:         3000,
 *     tailscale_ip: "100.x.x.x" | null,
 *     lan_ips:      ["192.168.1.50", ...]
 *   }
 *
 * The endpoint is OPEN (no Bearer required) because clients need to
 * find the NAS BEFORE they have a token — see
 * ``openspec/changes/alejandria-v2/specs/nas-discovery-auth/spec.md``
 * § "Tailscale discovery fallback".
 *
 * Both the mDNS publisher and the Tailscale IP probe are injected
 * via string tokens so the suite does not need real Bonjour or a
 * live ``tailscale`` CLI. LAN IPs come from a separate
 * ``LAN_IPS`` token so the test can hand in a fixed list.
 */

const ORIGINAL_ENV = { ...process.env };

function setEnv(overrides: Record<string, string>): void {
  for (const [k, v] of Object.entries(overrides)) {
    process.env[k] = v;
  }
}

function restoreEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  }
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    process.env[k] = v;
  }
}

/** In-memory ``DevicesRepository`` faithful to the contract used elsewhere. */
class InMemoryDevicesRepository {
  async insert(): Promise<{ deviceId: string; pairedAt: Date }> {
    return { deviceId: 'noop', pairedAt: new Date() };
  }
  async findByDeviceId(): Promise<unknown> {
    return null;
  }
  async updateTokenHash(): Promise<void> {
    /* no-op */
  }
  async touch(): Promise<void> {
    /* no-op */
  }
  async close(): Promise<void> {
    /* no-op */
  }
}

async function buildApp(overrides: {
  mdnsName: string;
  port: number;
  tailscaleIp: string | null;
  lanIps: string[];
}): Promise<INestApplication> {
  setEnv({
    NAS_PAIR_PIN: '12345678',
    NAS_PIN_TTL_DAYS: '30',
    NAS_JWT_SECRET: 'test-secret-do-not-use-in-prod-must-be-32+bytes',
    NAS_JWT_TTL_HOURS: '24',
    PORT: String(overrides.port),
  });
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(DEVICES_REPOSITORY)
    .useValue(new InMemoryDevicesRepository())
    // The mDNS publisher is injected by string token so tests do
    // not need a real Bonjour responder.
    .overrideProvider(MDNS_NAME)
    .useValue(overrides.mdnsName)
    // Tailscale detection is wrapped behind a string token so
    // tests can simulate both "tailscale up" and "not installed"
    // without spawning a real subprocess.
    .overrideProvider(TAILSCALE_SHELL)
    .useValue({
      async run(_cmd: string, _args: readonly string[]): Promise<{
        stdout: string;
        stderr: string;
        code: number;
      }> {
        if (overrides.tailscaleIp === null) {
          return { stdout: '', stderr: '', code: 1 };
        }
        return { stdout: overrides.tailscaleIp, stderr: '', code: 0 };
      },
    })
    // LAN IP enumeration is delegated to a string token so tests
    // can pin the list deterministically.
    .overrideProvider(LAN_IPS)
    .useValue(overrides.lanIps)
    .compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

describe('GET /api/discovery/info', () => {
  afterEach(() => {
    restoreEnv();
  });

  it('returns 200 with mdns_name, port, tailscale_ip and lan_ips when Tailscale is up', async () => {
    const app = await buildApp({
      mdnsName: 'alejandria-nas.local',
      port: 3000,
      tailscaleIp: '100.64.0.5',
      lanIps: ['192.168.1.50', '192.168.1.51'],
    });
    try {
      const res = await request(app.getHttpServer())
        .get('/api/discovery/info')
        .expect(200);
      expect(res.body).toEqual({
        mdns_name: 'alejandria-nas.local',
        port: 3000,
        tailscale_ip: '100.64.0.5',
        lan_ips: ['192.168.1.50', '192.168.1.51'],
      });
    } finally {
      await app.close();
    }
  });

  it('returns tailscale_ip: null when Tailscale is not running', async () => {
    const app = await buildApp({
      mdnsName: 'alejandria-nas.local',
      port: 3000,
      tailscaleIp: null,
      lanIps: ['192.168.1.50'],
    });
    try {
      const res = await request(app.getHttpServer())
        .get('/api/discovery/info')
        .expect(200);
      expect(res.body.tailscale_ip).toBeNull();
      expect(res.body.mdns_name).toBe('alejandria-nas.local');
      expect(res.body.port).toBe(3000);
      expect(res.body.lan_ips).toEqual(['192.168.1.50']);
    } finally {
      await app.close();
    }
  });

  it('returns an empty lan_ips array when the host has no non-loopback interfaces', async () => {
    const app = await buildApp({
      mdnsName: 'alejandria-nas.local',
      port: 8080,
      tailscaleIp: '100.64.0.5',
      lanIps: [],
    });
    try {
      const res = await request(app.getHttpServer())
        .get('/api/discovery/info')
        .expect(200);
      expect(res.body.port).toBe(8080);
      expect(res.body.lan_ips).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('is open (no Bearer required)', async () => {
    // No Authorization header at all — the endpoint must still
    // succeed because clients need it BEFORE they have a token.
    const app = await buildApp({
      mdnsName: 'alejandria-nas.local',
      port: 3000,
      tailscaleIp: null,
      lanIps: [],
    });
    try {
      await request(app.getHttpServer())
        .get('/api/discovery/info')
        .expect(200);
    } finally {
      await app.close();
    }
  });
});
