import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  DeviceLookup,
  LibrariesService,
  LibraryBookCount,
  LIBRARY_BOOK_COUNT,
  DEVICES_LOOKUP,
} from '../src/libraries/libraries.service';
import {
  Library,
  LibraryPatch,
  NewLibrary,
} from '../src/libraries/libraries.types';
import {
  LibrariesRepository,
  LIBRARIES_REPOSITORY,
} from '../src/libraries/libraries.repository';

/**
 * Unit tests for {@link LibrariesService}.
 *
 * The service is exercised in isolation with in-memory stubs
 * for its three seams (LibrariesRepository, DeviceLookup,
 * LibraryBookCount). The contract pinned here is the
 * authorisation + business rules the HTTP layer depends on,
 * so the controller e2e can stay focused on the wire shape
 * and the repository contract can stay focused on the SQL.
 */

class InMemoryLibrariesRepository implements LibrariesRepository {
  private rows: Library[] = [];
  private nextId = 1;

  async list(): Promise<Library[]> {
    return [...this.rows].sort((a, b) => a.id - b.id);
  }

  async findById(id: number): Promise<Library | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }

  async insert(library: NewLibrary): Promise<Library> {
    const row: Library = {
      id: this.nextId++,
      name: library.name,
      rootPath: library.rootPath,
      createdByDeviceId: library.createdByDeviceId,
      createdAt: new Date(),
    };
    this.rows.push(row);
    return row;
  }

  async update(id: number, patch: LibraryPatch): Promise<Library | null> {
    const idx = this.rows.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    const current = this.rows[idx]!;
    const next: Library = {
      ...current,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.rootPath !== undefined ? { rootPath: patch.rootPath } : {}),
    };
    this.rows[idx] = next;
    return next;
  }

  async delete(id: number): Promise<boolean> {
    const idx = this.rows.findIndex((r) => r.id === id);
    if (idx === -1) return false;
    this.rows.splice(idx, 1);
    return true;
  }

  async setActiveForDevice(_deviceId: string, _libraryId: number): Promise<void> {
    // The unit test does not exercise the per-device flag; the
    // contract is pinned separately by the repository e2e.
  }

  async getActiveForDevice(_deviceId: string): Promise<Library | null> {
    return null;
  }

  async close(): Promise<void> {}
}

class InMemoryDeviceLookup implements DeviceLookup {
  private deviceIds: Set<string> = new Set();

  add(deviceId: string): void {
    this.deviceIds.add(deviceId);
  }

  async findByDeviceId(deviceId: string): Promise<{ deviceId: string } | null> {
    return this.deviceIds.has(deviceId) ? { deviceId } : null;
  }
}

class InMemoryBookCount implements LibraryBookCount {
  private counts: Map<number, number> = new Map();

  set(libraryId: number, count: number): void {
    this.counts.set(libraryId, count);
  }

  async countByLibrary(libraryId: number): Promise<number> {
    return this.counts.get(libraryId) ?? 0;
  }
}

function buildService(opts: {
  deviceIds?: string[];
  bookCounts?: Map<number, number>;
} = {}): {
  service: LibrariesService;
  repo: InMemoryLibrariesRepository;
  devices: InMemoryDeviceLookup;
  bookCount: InMemoryBookCount;
} {
  const repo = new InMemoryLibrariesRepository();
  const devices = new InMemoryDeviceLookup();
  for (const id of opts.deviceIds ?? []) {
    devices.add(id);
  }
  const bookCount = new InMemoryBookCount();
  for (const [id, count] of opts.bookCounts ?? []) {
    bookCount.set(id, count);
  }
  // The service uses NestJS @Inject tokens; for the unit test
  // we construct it directly with the resolved dependencies.
  const service = new LibrariesService(
    repo as unknown as LibrariesRepository,
    devices as unknown as DeviceLookup,
    bookCount as unknown as LibraryBookCount,
  );
  return { service, repo, devices, bookCount };
}

describe('LibrariesService.create', () => {
  it('stamps createdByDeviceId with the caller and returns the row', async () => {
    const { service, repo } = buildService();
    const row = await service.create('dev-A', {
      name: 'Borges',
      rootPath: '/library/borges',
    });
    expect(row.id).toBeGreaterThan(0);
    expect(row.name).toBe('Borges');
    expect(row.rootPath).toBe('/library/borges');
    expect(row.createdByDeviceId).toBe('dev-A');
    // Round-trip through the repository so the test would FAIL
    // if create() returned a synthetic row without persisting.
    const found = await repo.findById(row.id);
    expect(found).toEqual(row);
  });
});

describe('LibrariesService.list', () => {
  it('returns every library ordered by id ASC', async () => {
    const { service } = buildService();
    await service.create('dev-A', { name: 'A', rootPath: '/lib/a' });
    await service.create('dev-B', { name: 'B', rootPath: '/lib/b' });
    const rows = await service.list();
    expect(rows.map((r) => r.name)).toEqual(['A', 'B']);
  });

  it('returns an empty array when no library has been created', async () => {
    const { service } = buildService();
    const rows = await service.list();
    expect(rows).toEqual([]);
  });
});

describe('LibrariesService.getById', () => {
  it('returns the library when it exists', async () => {
    const { service } = buildService();
    const created = await service.create('dev-A', {
      name: 'Sci-Fi',
      rootPath: '/lib/scifi',
    });
    const row = await service.getById(created.id);
    expect(row.id).toBe(created.id);
    expect(row.name).toBe('Sci-Fi');
  });

  it('throws 404 NOT_FOUND when the library does not exist', async () => {
    const { service } = buildService();
    await expect(service.getById(9999)).rejects.toThrow(NotFoundException);
  });
});

describe('LibrariesService.update', () => {
  it('lets the creator update the library', async () => {
    const { service } = buildService();
    const created = await service.create('dev-A', {
      name: 'Old',
      rootPath: '/lib/old',
    });
    const updated = await service.update('dev-A', created.id, {
      name: 'New',
    });
    expect(updated.name).toBe('New');
    expect(updated.rootPath).toBe('/lib/old');
  });

  it('refuses with 403 FORBIDDEN when the caller is not the creator', async () => {
    const { service } = buildService();
    const created = await service.create('dev-A', {
      name: 'Mine',
      rootPath: '/lib/mine',
    });
    await expect(
      service.update('dev-B', created.id, { name: 'Hijacked' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('refuses with 404 NOT_FOUND when the library does not exist', async () => {
    const { service } = buildService();
    await expect(
      service.update('dev-A', 9999, { name: 'X' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('refuses with 404 EMPTY_PATCH when the body has no fields', async () => {
    const { service } = buildService();
    const created = await service.create('dev-A', {
      name: 'Stable',
      rootPath: '/lib/stable',
    });
    await expect(
      service.update('dev-A', created.id, {}),
    ).rejects.toThrow(NotFoundException);
  });

  it('updates only the supplied fields', async () => {
    const { service } = buildService();
    const created = await service.create('dev-A', {
      name: 'Original',
      rootPath: '/lib/original',
    });
    const updated = await service.update('dev-A', created.id, {
      rootPath: '/lib/new',
    });
    expect(updated.name).toBe('Original');
    expect(updated.rootPath).toBe('/lib/new');
  });
});

describe('LibrariesService.delete', () => {
  it('lets the creator delete the library when it has no books', async () => {
    const { service, repo } = buildService();
    const created = await service.create('dev-A', {
      name: 'Doomed',
      rootPath: '/lib/doomed',
    });
    await service.delete('dev-A', created.id);
    const after = await repo.findById(created.id);
    expect(after).toBeNull();
  });

  it('refuses with 403 FORBIDDEN when the caller is not the creator', async () => {
    const { service } = buildService();
    const created = await service.create('dev-A', {
      name: 'Mine',
      rootPath: '/lib/mine',
    });
    await expect(service.delete('dev-B', created.id)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('refuses with 409 LIBRARY_NOT_EMPTY when the library has books', async () => {
    const { service } = buildService();
    const created = await service.create('dev-A', {
      name: 'Busy',
      rootPath: '/lib/busy',
    });
    const { bookCount } = buildService();
    bookCount.set(created.id, 5);
    // Re-build the service to wire the stub that reports 5
    // books for the library we just created.
    const repo = new InMemoryLibrariesRepository();
    await repo.insert({
      name: 'Busy',
      rootPath: '/lib/busy',
      createdByDeviceId: 'dev-A',
    });
    const devices = new InMemoryDeviceLookup();
    devices.add('dev-A');
    const wiredBookCount = new InMemoryBookCount();
    wiredBookCount.set(1, 5);
    const wiredService = new LibrariesService(
      repo as unknown as LibrariesRepository,
      devices as unknown as DeviceLookup,
      wiredBookCount as unknown as LibraryBookCount,
    );
    await expect(wiredService.delete('dev-A', 1)).rejects.toThrow(
      ConflictException,
    );
  });

  it('refuses with 404 NOT_FOUND when the library does not exist', async () => {
    const { service } = buildService();
    await expect(service.delete('dev-A', 9999)).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('LibrariesService.setActive', () => {
  it('returns the library when the row exists', async () => {
    const { service } = buildService();
    const created = await service.create('dev-A', {
      name: 'Mine',
      rootPath: '/lib/mine',
    });
    const result = await service.setActive('dev-A', created.id);
    expect(result.library.id).toBe(created.id);
  });

  it('refuses with 404 NOT_FOUND when the library does not exist', async () => {
    const { service } = buildService();
    await expect(service.setActive('dev-A', 9999)).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('LibrariesService.getCreatorDeviceId', () => {
  it('returns the creator UUID when the device row still exists', async () => {
    const { service } = buildService({ deviceIds: ['dev-A'] });
    const created = await service.create('dev-A', {
      name: 'Mine',
      rootPath: '/lib/mine',
    });
    const creator = await service.getCreatorDeviceId(created);
    expect(creator).toBe('dev-A');
  });

  it('returns null when the device row has been pruned', async () => {
    const { service } = buildService();
    const created = await service.create('dev-pruned', {
      name: 'Orphan',
      rootPath: '/lib/orphan',
    });
    const creator = await service.getCreatorDeviceId(created);
    expect(creator).toBeNull();
  });

  it('returns null when the library has no creator (admin import)', async () => {
    const { service, repo } = buildService();
    const imported = await repo.insert({
      name: 'Imported',
      rootPath: '/lib/imported',
      createdByDeviceId: null,
    });
    const creator = await service.getCreatorDeviceId(imported);
    expect(creator).toBeNull();
  });
});

/* Smoke checks that the exported tokens exist for the DI
   wiring (LibrariesModule + e2e override hooks). */
describe('Libraries service DI tokens', () => {
  it('exports the three injection tokens used by LibrariesModule', () => {
    expect(typeof LIBRARIES_REPOSITORY).toBe('string');
    expect(typeof DEVICES_LOOKUP).toBe('string');
    expect(typeof LIBRARY_BOOK_COUNT).toBe('string');
  });
});
