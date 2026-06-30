/**
 * Library domain types — PR-N2 (multi-library registry).
 *
 * The library is the unit of browsing on the NAS: every book
 * row in the catalog is scoped to exactly one library, and
 * each paired device picks one of the available libraries as
 * its active browsing target.
 *
 * The wire shape (snake_case) lives in ``libraries.service.ts``;
 * the types in this file are the in-process TypeScript
 * representation that flows between the repository, service,
 * and controller.
 */

/**
 * Shape of a row in the ``libraries`` table.
 *
 * ``id`` is BIGSERIAL so it stays compatible with the rest of
 * the catalog (books.author_id, downloads.id, …) which all use
 * BIGINT. ``createdByDeviceId`` is the UUID of the paired
 * device that minted the row; the service layer uses it as the
 * authorisation anchor for PATCH and DELETE.
 */
export interface Library {
  id: number;
  name: string;
  rootPath: string;
  createdByDeviceId: string | null;
  createdAt: Date;
}

/** Subset of {@link Library} accepted by {@link LibrariesRepository.insert}. */
export interface NewLibrary {
  name: string;
  rootPath: string;
  createdByDeviceId: string | null;
}

/**
 * Subset of {@link Library} accepted by {@link LibrariesRepository.update}.
 *
 * Every field is optional; the repository only overwrites the
 * fields the caller actually supplied. The service layer rejects
 * an empty patch (no fields to update) before it reaches the
 * repository, so callers always pass at least one key.
 */
export interface LibraryPatch {
  name?: string;
  rootPath?: string;
}

/**
 * Per-device active library membership — row in ``device_libraries``.
 *
 * The composite primary key is ``(deviceId, libraryId)`` so
 * callers can read it back exactly the way they wrote it.
 */
export interface DeviceLibrary {
  deviceId: string;
  libraryId: number;
  active: boolean;
}
