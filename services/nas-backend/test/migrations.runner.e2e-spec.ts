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
 * commit); PR-2C extends the chain with migration 010 (devices
 * table). Each slice adds its own migration files and the runner
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
    // All ten migrations shipped in PR-2B + PR-2C must be present.
    expect(names).toEqual(
      expect.arrayContaining([
        '001_extensions.sql',
        '002_authors.sql',
        '003_books.sql',
        '004_categories.sql',
        '005_book_categories.sql',
        '006_sagas.sql',
        '007_downloads.sql',
        '008_pgroonga_indexes.sql',
        '009_seed_categories.sql',
        '010_devices.sql',
      ]),
    );
    // Order must be lexicographic (which equals numeric for fixed-
    // width prefixes like ``001``).
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });

  it('applies all migrations cleanly against a fresh schema', async () => {
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
        '008_pgroonga_indexes.sql',
        '009_seed_categories.sql',
        '010_devices.sql',
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

      // pgroonga indexes on books.title and books.excerpt must be
      // present after migration 008 runs. This is the explicit
      // acceptance criterion for the FTS-ready schema.
      const pgIdx = await pool.query<{ indexname: string }>(
        "SELECT indexname FROM pg_indexes WHERE tablename = 'books' AND indexname LIKE '%pgroonga%' ORDER BY indexname",
      );
      expect(pgIdx.rows.map((r) => r.indexname)).toEqual([
        'books_excerpt_pgroonga_idx',
        'books_title_pgroonga_idx',
      ]);

      // PR-2C: migration 010 introduces the ``devices`` table for
      // PIN-pairing auth. The columns must be in the documented
      // order so callers (and the ``devices.repository``) can rely
      // on positional reads via ``pg``.
      const deviceCols = await pool.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'devices' ORDER BY ordinal_position",
      );
      expect(deviceCols.rows.map((r) => r.column_name)).toEqual([
        'id',
        'device_id',
        'device_name',
        'token_hash',
        'paired_at',
        'last_seen_at',
        'ip_address',
      ]);

      // Migration 009 seeds a small bilingual taxonomy. The
      // categories table must contain at least the top-level nodes
      // with their ``name_es`` / ``name_en`` pairs.
      const seed = await pool.query<{
        id: string;
        path: string;
        name_es: string;
        name_en: string;
        depth: number;
        parent_id: string | null;
      }>(
        "SELECT id, path, name_es, name_en, depth, parent_id FROM categories ORDER BY path ASC",
      );
      const paths = seed.rows.map((r) => r.path);
      expect(paths).toEqual(
        expect.arrayContaining([
          '/ciencia',
          '/ciencia/biologia',
          '/ciencia/biologia/zoologia',
          '/arte',
          '/arte/pintura',
          '/literatura',
          '/literatura/novela',
        ]),
      );
      const ciencia = seed.rows.find((r) => r.path === '/ciencia');
      expect(ciencia?.name_es).toBe('Ciencia');
      expect(ciencia?.name_en).toBe('Science');
      expect(ciencia?.depth).toBe(0);
      expect(ciencia?.parent_id).toBeNull();

      const biologia = seed.rows.find((r) => r.path === '/ciencia/biologia');
      expect(biologia?.depth).toBe(1);
      // Parent wiring must be set by the UPDATE in the same
      // migration so ``findSubtree`` has a populated ``parent_id``
      // to traverse from.
      expect(biologia?.parent_id).toBe(ciencia?.id);
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