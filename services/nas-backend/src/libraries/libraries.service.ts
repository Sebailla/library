import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DeviceLibrary,
  Library,
  LibraryPatch,
  NewLibrary,
} from './libraries.types';
import {
  LibrariesRepository,
  LIBRARIES_REPOSITORY,
} from './libraries.repository';

/**
 * String token for the device-lookup seam the service uses to
 * resolve a paired device by its UUID. Production wiring binds
 * it to the pg-backed ``DevicesRepository``; tests can override
 * it with a stub so the suite pins the authorisation rules
 * without a live database.
 */
export const DEVICES_LOOKUP = 'LIBRARY_DEVICES_LOOKUP';

/**
 * Minimal device-lookup contract the service needs. Mirrors
 * the shape of {@link Device} from the auth module without
 * pulling the whole type graph across the seam.
 */
export interface DeviceLookup {
  findByDeviceId(deviceId: string): Promise<{ deviceId: string } | null>;
}

/**
 * Repository contract used by the service to count how many
 * books are currently indexed for a given library. The
 * service blocks DELETE when the count is > 0 (409
 * LIBRARY_NOT_EMPTY). Exposed as a token so e2e tests can
 * stub it without spinning up a real database.
 */
export interface LibraryBookCount {
  countByLibrary(libraryId: number): Promise<number>;
}

/** String token for the book-count repository seam. */
export const LIBRARY_BOOK_COUNT = 'LIBRARY_BOOK_COUNT';

/**
 * Wire-shape (snake_case) returned by the library HTTP routes.
 * Mirrors the {@link Library} domain type but converts the
 * Date to an ISO string and matches the casing the rest of
 * the API exposes to clients.
 */
export interface LibraryDto {
  id: number;
  name: string;
  root_path: string;
  created_by_device_id: string | null;
  created_at: string;
}

/**
 * Body accepted by ``POST /api/libraries``. Both fields are
 * required so the scanner always has a root_path to walk.
 */
export interface CreateLibraryInput {
  name: string;
  rootPath: string;
}

/** Body accepted by ``PATCH /api/libraries/:id``. */
export interface UpdateLibraryInput {
  name?: string;
  rootPath?: string;
}

/**
 * Multi-library service — PR-N2 work unit.
 *
 * Orchestrates the {@link LibrariesRepository} for the
 * ``/api/libraries`` HTTP surface. The service is the layer
 * that enforces the business rules:
 *
 *   - Any paired device can CREATE a library.
 *   - Only the creator (matched on ``created_by_device_id``)
 *     can PATCH or DELETE the library.
 *   - DELETE is refused with 409 LIBRARY_NOT_EMPTY when the
 *     library still has books indexed (defends the
 *     ``books.library_id`` FK).
 *   - ``setActive`` upserts a ``device_libraries`` row and
 *     flips the previous active row off, so each device has
 *     at most one active library.
 */
@Injectable()
export class LibrariesService {
  constructor(
    @Inject(LIBRARIES_REPOSITORY)
    private readonly libraries: LibrariesRepository,
    @Inject(DEVICES_LOOKUP)
    private readonly devices: DeviceLookup,
    @Inject(LIBRARY_BOOK_COUNT)
    private readonly bookCount: LibraryBookCount,
  ) {}

  /**
   * Create a new library. The caller is the creator; the row
   * is stamped with their ``deviceId`` so the authorisation
   * rules for PATCH/DELETE can match it later.
   */
  async create(
    deviceId: string,
    input: CreateLibraryInput,
  ): Promise<Library> {
    const row: NewLibrary = {
      name: input.name,
      rootPath: input.rootPath,
      createdByDeviceId: deviceId,
    };
    return this.libraries.insert(row);
  }

  /** List every library, ordered by id ASC. */
  async list(): Promise<Library[]> {
    return this.libraries.list();
  }

  /**
   * Fetch a single library by id; throws 404 when missing.
   * The route handler maps the throw to the project error
   * envelope so callers see ``error.code = NOT_FOUND``.
   */
  async getById(id: number): Promise<Library> {
    const row = await this.libraries.findById(id);
    if (!row) {
      throw new NotFoundException({
        error: { code: 'NOT_FOUND', message: 'Library not found' },
      });
    }
    return row;
  }

  /**
   * Update a library. Only the creator can PATCH; any other
   * caller receives 403 FORBIDDEN. The patch may be partial;
   * an empty patch is rejected with 404 EMPTY_PATCH so the
   * caller cannot silently no-op the route.
   */
  async update(
    deviceId: string,
    id: number,
    patch: UpdateLibraryInput,
  ): Promise<Library> {
    if (patch.name === undefined && patch.rootPath === undefined) {
      throw new NotFoundException({
        error: {
          code: 'EMPTY_PATCH',
          message: 'Update payload must include at least one field',
        },
      });
    }
    const existing = await this.libraries.findById(id);
    if (!existing) {
      throw new NotFoundException({
        error: { code: 'NOT_FOUND', message: 'Library not found' },
      });
    }
    this.assertCreator(existing, deviceId);
    const updated = await this.libraries.update(id, patch as LibraryPatch);
    if (!updated) {
      // The row vanished between the lookup and the UPDATE —
      // surface as 404 so the client can re-fetch.
      throw new NotFoundException({
        error: { code: 'NOT_FOUND', message: 'Library not found' },
      });
    }
    return updated;
  }

  /**
   * Delete a library. Refuses with 409 LIBRARY_NOT_EMPTY when
   * the library still has books indexed. Refuses with 403
   * FORBIDDEN when the caller is not the creator. 404 when
   * the row does not exist.
   */
  async delete(deviceId: string, id: number): Promise<void> {
    const existing = await this.libraries.findById(id);
    if (!existing) {
      throw new NotFoundException({
        error: { code: 'NOT_FOUND', message: 'Library not found' },
      });
    }
    this.assertCreator(existing, deviceId);
    const indexed = await this.bookCount.countByLibrary(id);
    if (indexed > 0) {
      throw new ConflictException({
        error: {
          code: 'LIBRARY_NOT_EMPTY',
          message: 'Library has books indexed; clear them before deleting',
        },
      });
    }
    await this.libraries.delete(id);
  }

  /**
   * Mark ``libraryId`` as the device's active library. 404
   * when the library does not exist. The endpoint is
   * idempotent — calling it twice with the same id leaves the
   * active flag set.
   */
  async setActive(
    deviceId: string,
    libraryId: number,
  ): Promise<{ library: Library }> {
    const existing = await this.libraries.findById(libraryId);
    if (!existing) {
      throw new NotFoundException({
        error: { code: 'NOT_FOUND', message: 'Library not found' },
      });
    }
    await this.libraries.setActiveForDevice(deviceId, libraryId);
    return { library: existing };
  }

  /**
   * Lookup the device that minted the library row. Returns
   * ``null`` when the device row was removed (e.g. an admin
   * pruned the devices table) — the service still treats
   * such a library as "owned by nobody" so the row stays
   * usable but only admins can modify it via SQL.
   */
  async getCreatorDeviceId(library: Library): Promise<string | null> {
    if (!library.createdByDeviceId) return null;
    const device = await this.devices.findByDeviceId(
      library.createdByDeviceId,
    );
    return device ? library.createdByDeviceId : null;
  }

  /**
   * Helper used by the service internals: throws 403 when the
   * caller is not the creator. Pulled out so the same shape
   * can be reused by future mutators (e.g. an admin override
   * would skip this check explicitly).
   */
  private assertCreator(library: Library, deviceId: string): void {
    if (library.createdByDeviceId !== deviceId) {
      throw new ForbiddenException({
        error: {
          code: 'FORBIDDEN',
          message: 'Only the creator can modify this library',
        },
      });
    }
  }
}

/**
 * Pure mapping helper — keeps the controller free of date
 * serialisation noise. Extracted so the e2e suite can pin
 * the wire shape with a single ``toLibraryDto(library)`` call
 * rather than duplicating the conversion in every test.
 */
export function toLibraryDto(library: Library): LibraryDto {
  return {
    id: library.id,
    name: library.name,
    root_path: library.rootPath,
    created_by_device_id: library.createdByDeviceId,
    created_at: library.createdAt.toISOString(),
  };
}

/**
 * Re-export so the e2e suite can build a stub that implements
 * the same surface as the pg-backed implementation.
 */
export type { Library, DeviceLibrary };
