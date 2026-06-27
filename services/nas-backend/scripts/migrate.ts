import { Pool, PoolConfig } from 'pg';

/**
 * TypeScript migration runner for the alejandria NAS backend.
 *
 * The runner is intentionally tiny — every migration lives in
 * ``migrations/*.sql`` as a numbered, idempotent file, and the runner
 * walks the directory in lexicographic order, applying each file in
 * its own transaction against the provided Postgres connection.
 *
 * Idempotency model
 * -----------------
 * - The runner does NOT maintain a ``schema_migrations`` table. It
 *   relies on each migration file using ``CREATE ... IF NOT EXISTS``
 *   (and equivalent guards for indexes / inserts). This keeps the
 *   schema layer declarative and avoids a chicken-and-egg migration
 *   that creates the bookkeeping table itself.
 * - Because every statement is guarded, running the runner twice in
 *   a row is safe and produces no errors.
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
 * Returns the names of files that were processed. Because the files
 * are idempotent, every run reports each file as ``applied``; the
 * field is kept distinct from ``skipped`` to leave room for a future
 * schema_migrations table without breaking the return shape.
 */
export async function runMigrations(
  options: RunMigrationsOptions = {},
): Promise<RunMigrationsResult> {
  const migrationsDir = options.migrationsDir ?? defaultMigrationsDir();
  const connectionString = options.connectionString ?? DEFAULT_CONNECTION;
  const files = await loadMigrations(migrationsDir);

  const pool = new Pool(options.poolConfig ?? { connectionString });
  const applied: string[] = [];
  try {
    for (const file of files) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(file.sql);
        await client.query('COMMIT');
        applied.push(file.name);
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

  return { applied, skipped: [] };
}