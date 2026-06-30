import { Pool, PoolClient } from 'pg';
import { runMigrations } from '../../scripts/migrate';

/**
 * Test fixtures for the repository test suites.
 *
 * The repositories are tested against a real Postgres + pgroonga
 * instance. Each test suite resets the public schema via the
 * migration runner so prior runs cannot leak state.
 *
 * Connection details come from ``DATABASE_URL``; tests skip when it
 * is not set so the suite remains runnable in environments without
 * a Postgres instance.
 */

export const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql:///alejandria';

const repoRootFor = (testDir: string): string => {
  // ``test/repositories/*.spec.ts`` lives two levels under the
  // service root; ``test/migrations.*.spec.ts`` lives one level;
  // ``test/admin/scan/*.spec.ts`` lives three levels. Walk up
  // until the parent directory contains a ``migrations`` folder
  // so every depth is supported without hardcoding the offset.
  let dir = testDir;
  // Bound the walk so a typo cannot loop forever.
  for (let i = 0; i < 6; i++) {
    const parent = dir.split('/').slice(0, -1).join('/') || dir;
    if (parent === dir) break;
    // Heuristic: the service root is the first ancestor that
    // contains a sibling ``migrations`` directory.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require('fs') as typeof import('fs');
      if (fs.existsSync(`${parent}/migrations`)) {
        return parent;
      }
    } catch {
      /* ignore — fs errors just mean we keep walking up */
    }
    dir = parent;
  }
  // Fallback to the historical 2-level offset.
  const segments = testDir.split('/');
  return segments.slice(0, segments.length - 2).join('/') || testDir;
};

export async function resetAndMigrate(testDir: string): Promise<void> {
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
    await pool.query('CREATE SCHEMA public');
  } finally {
    await pool.end();
  }
  // Re-enable extensions after the schema wipe so subsequent
  // migration 001 can CREATE EXTENSION IF NOT EXISTS them back into
  // the fresh public schema.
  await runMigrations({
    connectionString: DATABASE_URL,
    migrationsDir: `${repoRootFor(testDir)}/migrations`,
  });
}

export async function withClient<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    const client = await pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

/**
 * Insert a parent author row and return its id. The repositories
 * tested here always operate against an existing author, so this is
 * the most common fixture helper.
 */
export async function insertAuthor(
  lastname: string,
  firstname: string,
): Promise<number> {
  return withClient(async (client) => {
    const res = await client.query<{ id: string }>(
      'INSERT INTO authors (lastname, firstname) VALUES ($1, $2) RETURNING id',
      [lastname, firstname],
    );
    return Number(res.rows[0].id);
  });
}

/**
 * Insert a parent library row and return its id. Used by the
 * PR-N2 contract tests that exercise the new
 * ``books.library_id`` scoping.
 */
export async function insertLibrary(
  name: string,
  rootPath: string = `/lib/${name.toLowerCase()}`,
): Promise<number> {
  return withClient(async (client) => {
    const res = await client.query<{ id: string }>(
      'INSERT INTO libraries (name, root_path) VALUES ($1, $2) RETURNING id',
      [name, rootPath],
    );
    return Number(res.rows[0].id);
  });
}