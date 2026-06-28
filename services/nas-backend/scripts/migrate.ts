import { Pool, PoolClient, PoolConfig } from 'pg';

/**
 * TypeScript migration runner for the alejandria NAS backend.
 *
 * The runner is intentionally tiny — every migration lives in
 * ``migrations/*.sql`` as a numbered SQL file, and the runner
 * walks the directory in lexicographic order, applying each file
 * in its own transaction against the provided Postgres connection.
 *
 * Idempotency model (4R review #37)
 * ---------------------------------
 * - The runner owns a ``schema_migrations`` table that records
 *   every applied file (``filename``, ``applied_at``).
 * - On every run the runner first ensures the table exists
 *   (``CREATE TABLE IF NOT EXISTS``), then loads the set of
 *   already-applied filenames.
 * - Each unapplied file is wrapped in a single transaction that
 *   (a) inserts the schema_migrations row FIRST and (b) executes
 *   the file's SQL. If the file's SQL fails, the insert is
 *   rolled back too — so a fixed-and-retry path always re-runs
 *   the previously-failed file instead of skipping it.
 * - Files in ``schema_migrations`` short-circuit (reported in
 *   ``skipped``) so the runner is fast on warm starts.
 *
 * Usage
 * -----
 *   npm run migrate
 *   # or programmatically:
 *   await runMigrations({ connectionString: process.env.DATABASE_URL });
 */

export interface RunMigrationsOptions {
  /** pg connection string. Defaults to the alejandria local DB. */
  connectionString?: string;
  /** Absolute path to the migrations directory. */
  migrationsDir?: string;
  /** Override the pg pool config (used in tests). */
  poolConfig?: PoolConfig;
}

const DEFAULT_CONNECTION =
  'postgresql://alejandria:alejandria@localhost:5432/alejandria';

/**
 * DDL for the bookkeeping table. ``filename`` is the primary key
 * so a re-application raises a unique-violation the caller can
 * catch. ``applied_at`` is a timestamptz so operators can sort /
 * filter by recency.
 */
const SCHEMA_MIGRATIONS_DDL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )
`;

/** Locate the default migrations directory shipped with the package. */
function defaultMigrationsDir(): string {
  // The runner lives in ``scripts/`` and migrations in ``migrations/``,
  // both at the same level under ``services/nas-backend/``.
  return require('path').resolve(__dirname, '..', 'migrations');
}

export interface MigrationFile {
  /** Filename, e.g. ``001_extensions.sql``. */
  name: string;
  /** Absolute path on disk. */
  path: string;
  /** Raw SQL contents. */
  sql: string;
}

/**
 * Read every ``*.sql`` file in ``migrationsDir`` and return them
 * sorted by filename. Exported for tests.
 */
export async function loadMigrations(
  migrationsDir: string = defaultMigrationsDir(),
): Promise<MigrationFile[]> {
  const fs = await import('fs/promises');
  const entries = await fs.readdir(migrationsDir, { withFileTypes: true });
  const sqlFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith('.sql'))
    .map((e) => e.name)
    .sort();
  const files: MigrationFile[] = [];
  for (const name of sqlFiles) {
    const path = require('path').join(migrationsDir, name);
    const sql = await fs.readFile(path, 'utf8');
    files.push({ name, path, sql });
  }
  return files;
}

export interface RunMigrationsResult {
  applied: string[];
  skipped: string[];
}

/**
 * Apply every migration file in order. Each file runs in its own
 * transaction so a partial failure leaves the database unchanged.
 *
 * The schema_migrations bookkeeping table is created on every run
 * (``CREATE TABLE IF NOT EXISTS``). Already-applied files
 * short-circuit and are reported under ``skipped``. Newly-applied
 * files are reported under ``applied`` and inserted into the
 * bookkeeping table inside the same transaction as the file's
 * own SQL — so a partial failure rolls back the row too.
 */
export async function runMigrations(
  options: RunMigrationsOptions = {},
): Promise<RunMigrationsResult> {
  const migrationsDir = options.migrationsDir ?? defaultMigrationsDir();
  const connectionString = options.connectionString ?? DEFAULT_CONNECTION;
  const files = await loadMigrations(migrationsDir);

  const pool = new Pool(options.poolConfig ?? { connectionString });
  const applied: string[] = [];
  const skipped: string[] = [];
  try {
    // Bootstrap the bookkeeping table on a dedicated client so the
    // CREATE TABLE is committed before any migration runs. The
    // table is owned by the runner (not a migration file) because
    // a chicken-and-egg migration that created it would itself
    // need an entry in the table.
    const bootstrap = await pool.connect();
    try {
      await bootstrap.query(SCHEMA_MIGRATIONS_DDL);
    } finally {
      bootstrap.release();
    }

    const alreadyApplied = new Set<string>(
      (await loadAppliedFilenames(pool)).map((r) => r.filename),
    );

    for (const file of files) {
      if (alreadyApplied.has(file.name)) {
        skipped.push(file.name);
        continue;
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Insert the bookkeeping row FIRST. If the migration's
        // own SQL fails the insert is rolled back together with
        // the file, so a fixed-and-retry always re-runs the
        // previously-failed file.
        await client.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1)',
          [file.name],
        );
        await client.query(file.sql);
        await client.query('COMMIT');
        applied.push(file.name);
        alreadyApplied.add(file.name);
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw new Error(
          `migration ${file.name} failed: ${(err as Error).message}`,
        );
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }

  return { applied, skipped };
}

/**
 * Read the set of filenames already recorded in
 * ``schema_migrations``. Exported for tests; not part of the
 * public contract.
 */
export async function loadAppliedFilenames(
  pool: Pool,
): Promise<Array<{ filename: string; applied_at: string }>> {
  // The table is created by ``runMigrations`` before this is
  // called; in a fresh DB the create is part of the bootstrap
  // step. If a caller invokes this against a pool that has not
  // been bootstrapped we surface a real error (better than
  // silently swallowing the missing relation).
  const res = await pool.query<{ filename: string; applied_at: string }>(
    'SELECT filename, applied_at FROM schema_migrations',
  );
  return res.rows;
}

// Re-export the underlying pg client type for callers that need
// to drive the runner with their own pool (test seams).
export type { PoolClient };