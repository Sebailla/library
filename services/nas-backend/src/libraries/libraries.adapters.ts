import { Inject, Injectable } from '@nestjs/common';
import {
  BooksRepository,
  BOOKS_REPOSITORY,
} from '../books/books.repository';
import { Device } from '../auth/devices.repository';
import { DEVICES_REPOSITORY } from '../auth/devices.repository';
import { LibraryBookCount } from './libraries.service';

/**
 * Adapter that bridges the {@link BooksRepository} interface
 * (which lives in ``BooksModule``) to the narrower
 * {@link LibraryBookCount} contract the libraries service
 * depends on.
 *
 * The libraries module imports this adapter as its
 * ``LIBRARY_BOOK_COUNT`` provider so the e2e suite can override
 * the count for the "409 LIBRARY_NOT_EMPTY" path without
 * stubbing the whole books repository surface.
 */
@Injectable()
export class PgLibraryBookCountAdapter implements LibraryBookCount {
  constructor(
    @Inject(BOOKS_REPOSITORY) private readonly books: BooksRepository,
  ) {}

  countByLibrary(libraryId: number): Promise<number> {
    return this.books.countByLibrary(libraryId);
  }
}

/**
 * Adapter that bridges the {@link Device} shape from the auth
 * module's devices repository to the narrow
 * ``DeviceLookup`` contract the libraries service depends on.
 *
 * The lookup returns the bare ``{ deviceId }`` object so the
 * service never has to import the full ``Device`` type — that
 * keeps the libraries module's dependency on the auth module
 * one-way (no circular import) and lets the e2e suite stub the
 * lookup without spinning up the whole devices table.
 */
@Injectable()
export class PgDeviceLookupAdapter {
  constructor(
    @Inject(DEVICES_REPOSITORY)
    private readonly devices: {
      findByDeviceId(deviceId: string): Promise<Device | null>;
    },
  ) {}

  async findByDeviceId(
    deviceId: string,
  ): Promise<{ deviceId: string } | null> {
    const row = await this.devices.findByDeviceId(deviceId);
    return row ? { deviceId: row.deviceId } : null;
  }
}
