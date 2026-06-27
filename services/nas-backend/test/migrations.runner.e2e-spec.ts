import * as path from 'path';
import { Pool } from 'pg';
import { loadMigrations, runMigrations } from '../scripts/migrate';

/**
 * Tests for the migration runner.
 *
 * These tests run against a real Postgres database (with pgroonga +
 * pgcrypto installed) so they exercise the SQL files end-to-end, not
 * just the runner's control flow. The connection details come from
 * the ``DATABASE_URL`` environment variable — CI must export it.
 *
 * The tests reset the public schema between runs so a previous run
 * cannot pollute the next one. This keeps the suite deterministic
 * without requiring a per-test database.
 *
 * PR-2B ships migrations 001-009 incrementally (one slice per
 * commit). Each slice adds its own migration files and the runner
 * tests assert the slice's expected outcome. Earlier slices are
 * still verified because the runner re-applies them on every run.
 */

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql:///alejandria';

const skipIfNoDb = process.env.DATABASE_URL ? describe : describe.skip;

const repoRoot = path.resolve(__dirname, '..');

async function resetSchema(): Promise<void> {
  const pool = new Pool({ connectionString });
  try {
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
    await pool.query('CREATE SCHEMA public');
  } finally {
    await pool.end();
  }
}

skipIfNoDb('migration runner', () => {
  beforeEach(async () => {
    await resetSchema();
  });

  it('lists migration files in lexicographic order', async () => {
    const files = await loadMigrations(path.join(repoRoot, 'migrations'));
    const names = files.map((f) => f.name);
    // At minimum, the 001-007 files shipped through PR-2B commit 7
    // must be picked up. Subsequent commits add 008-009; those are
    // verified by their own commits.
    expect(names).toEqual(
      expect.arrayContaining([
        '001_extensions.sql',
        '002_authors.sql',
        '003_books.sql',
        '004_categories.sql',
        '005_book_categories.sql',
        '006_sagas.sql',
        '007_downloads.sql',
      ]),
    );
    // Order must be lexicographic (which equals numeric for fixed-
    // width prefixes like ``001``).
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });

  it('applies migrations 001-007 cleanly against a fresh schema', async () => {
    const result = await runMigrations({
      connectionString,
      migrationsDir: path.join(repoRoot, 'migrations'),
    });
    expect(result.applied).toEqual(
      expect.arrayContaining([
        '001_extensions.sql',
        '002_authors.sql',
        '003_books.sql',
        '004_categories.sql',
        '005_book_categories.sql',
        '006_sagas.sql',
        '007_downloads.sql',
      ]),
    );

    // After the run, the pgroonga + pgcrypto extensions must be
    // installed and the categories + book_categories tables must
    // exist with the expected shape.
    const pool = new Pool({ connectionString });
    try {
      const exts = await pool.query<{ extname: string }>(
        "SELECT extname FROM pg_extension WHERE extname IN ('pgroonga', 'pgcrypto') ORDER BY extname",
      );
      expect(exts.rows.map((r) => r.extname)).toEqual([
        'pgcrypto',
        'pgroonga',
      ]);

      const catCols = await pool.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'categories' ORDER BY ordinal_position",
      );
      expect(catCols.rows.map((r) => r.column_name)).toEqual([
        'id',
        'path',
        'name_es',
        'name_en',
        'parent_id',
        'depth',
        'created_at',
      ]);

      const aliasCols = await pool.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'category_aliases' ORDER BY ordinal_position",
      );
      expect(aliasCols.rows.map((r) => r.column_name)).toEqual([
        'category_id',
        'alias',
        'locale',
        'created_at',
      ]);

      const bridgeCols = await pool.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'book_categories' ORDER BY ordinal_position",
      );
      expect(bridgeCols.rows.map((r) => r.column_name)).toEqual([
        'book_id',
        'category_id',
        'confidence',
        'source',
      ]);

      const sagaCols = await pool.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'sagas' ORDER BY ordinal_position",
      );
      expect(sagaCols.rows.map((r) => r.column_name)).toEqual([
        'id',
        'name',
        'author_id',
        'created_at',
      ]);

      const bookSagasCols = await pool.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'book_sagas' ORDER BY ordinal_position",
      );
      expect(bookSagasCols.rows.map((r) => r.column_name)).toEqual([
        'book_id',
        'saga_id',
        'ordinal',
      ]);

      const downloadCols = await pool.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'downloads' ORDER BY ordinal_position",
      );
      expect(downloadCols.rows.map((r) => r.column_name)).toEqual([
        'id',
        'book_id',
        'device_id',
        'device_name',
        'user_id',
        'downloaded_at',
        'file_size_bytes',
        'bytes_transferred',
        'completed',
        'ip_address',
        'user_agent',
      ]);
    } finally {
      await pool.end();
    }
  });

  it('is idempotent — running twice produces no errors', async () => {
    const opts = {
      connectionString,
      migrationsDir: path.join(repoRoot, 'migrations'),
    };
    await runMigrations(opts);
    // Second run must not throw; every CREATE statement is guarded.
    await expect(runMigrations(opts)).resolves.toBeDefined();
  });
});