#!/usr/bin/env ts-node
/* eslint-disable no-console */
import { runMigrations } from './migrate';

/**
 * CLI entry point for the migration runner.
 *
 * Usage:
 *   npm run migrate
 *
 * Equivalent to ``await runMigrations()`` with default settings
 * (``DATABASE_URL`` from the environment, ``migrations/`` next to
 * ``scripts/``). The runner is idempotent so re-running on an
 * already-migrated database is a safe no-op.
 */
async function main(): Promise<void> {
  try {
    const result = await runMigrations();
    console.log(
      `Applied ${result.applied.length} migration(s): ${result.applied.join(', ')}`,
    );
  } catch (err) {
    console.error('Migration failed:', (err as Error).message);
    process.exit(1);
  }
}

main();