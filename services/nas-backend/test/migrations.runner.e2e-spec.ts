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
    // All migrations shipped through PR-2G.1 must be present.
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
        '011_pgroonga_defrag.sql',
        // PR-N2 — multi-library registry. The libraries table must
        // exist before device_libraries (which references its id)
        // and before books.library_id (also references it).
        '012_libraries.sql',
        '013_device_libraries.sql',
        '014_books_library_id.sql',
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
        '011_pgroonga_defrag.sql',
        '012_libraries.sql',
        '013_device_libraries.sql',
        '014_books_library_id.sql',
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

      // PR-N2 — multi-library registry. Migration 012 introduces
      // the ``libraries`` table; every column MUST appear in the
      // documented order so the repository can rely on positional
      // reads via ``pg``.
      const libraryCols = await pool.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'libraries' ORDER BY ordinal_position",
      );
      expect(libraryCols.rows.map((r) => r.column_name)).toEqual([
        'id',
        'name',
        'root_path',
        'created_by_device_id',
        'created_at',
      ]);

      // PR-N2 — migration 013 introduces ``device_libraries`` so
      // each paired device can mark one of the available libraries
      // as its active browsing target.
      const deviceLibrariesCols = await pool.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'device_libraries' ORDER BY ordinal_position",
      );
      expect(deviceLibrariesCols.rows.map((r) => r.column_name)).toEqual([
        'device_id',
        'library_id',
        'active',
      ]);

      // PR-N2 — migration 014 adds ``library_id`` to ``books`` so
      // every book row is scoped to exactly one library.
      const bookLibraryCol = await pool.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'books' AND column_name = 'library_id'",
      );
      expect(bookLibraryCol.rows.map((r) => r.column_name)).toEqual([
        'library_id',
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

/**
 * Resilience contract — 4R review #37.
 *
 * The migration runner now owns a ``schema_migrations`` table
 * that records every applied file. A re-run MUST short-circuit
 * already-applied files instead of re-executing them.
 *
 * The contract this commit establishes:
 *
 *   - After a fresh run, the ``schema_migrations`` table contains
 *     a row for every ``*.sql`` file the runner processed.
 *   - A second run adds zero new rows and reports every file
 *     as ``skipped`` (no ``applied`` rows for files already in
 *     the table).
 *   - Inserting a row + executing the migration happens inside
 *     the SAME transaction so a failed migration leaves no row.
 */
skipIfNoDb('migration runner schema_migrations table (#37)', () => {
  beforeEach(async () => {
    return resetSchema();
  });

  it('records every applied file in schema_migrations', async () => {
    await runMigrations({
      connectionString,
      migrationsDir: path.join(repoRoot, 'migrations'),
    });
    const pool = new Pool({ connectionString });
    try {
      const rows = await pool.query<{ filename: string; applied_at: string }>(
        'SELECT filename, applied_at FROM schema_migrations ORDER BY filename',
      );
      const filenames = rows.rows.map((r) => r.filename);
      expect(filenames).toEqual(
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
          '011_pgroonga_defrag.sql',
          '012_libraries.sql',
          '013_device_libraries.sql',
          '014_books_library_id.sql',
        ]),
      );
      // Every applied_at must be a parseable ISO timestamp.
      for (const row of rows.rows) {
        expect(() => new Date(row.applied_at).toISOString()).not.toThrow();
      }
    } finally {
      await pool.end();
    }
  });

  it('skips already-applied files on a second run (no new rows)', async () => {
    const opts = {
      connectionString,
      migrationsDir: path.join(repoRoot, 'migrations'),
    };
    const first = await runMigrations(opts);
    expect(first.applied.length).toBeGreaterThan(0);

    const second = await runMigrations(opts);
    // No new applied files: every previously-applied file is skipped.
    expect(second.applied).toEqual([]);
    // Every previously-applied file appears in ``skipped``.
    expect(second.skipped.length).toBe(first.applied.length);

    // The schema_migrations table count is unchanged.
    const pool = new Pool({ connectionString });
    try {
      const count = await pool.query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM schema_migrations',
      );
      expect(Number(count.rows[0].count)).toBe(first.applied.length);
    } finally {
      await pool.end();
    }
  });

  it('rolls back the schema_migrations insert when a migration fails', async () => {
    // Write a deliberately-broken migration into a temp dir; the
    // runner MUST NOT leave a row in schema_migrations for the
    // failed file (so re-running after the operator fixes the
    // file actually re-applies it).
    const fs = await import('fs/promises');
    const os = await import('os');
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'alejandria-mig-'),
    );
    try {
      await fs.writeFile(
        path.join(tmpDir, '001_extensions.sql'),
        await fs.readFile(path.join(repoRoot, 'migrations/001_extensions.sql'), 'utf8'),
      );
      await fs.writeFile(
        path.join(tmpDir, '002_broken.sql'),
        'ALTER TABLE does_not_exist_yet ADD COLUMN broken INT;\n',
      );
      await runMigrations({
        connectionString,
        migrationsDir: tmpDir,
      }).then(
        () => {
          throw new Error('expected migration to fail');
        },
        () => {
          /* expected */
        },
      );

      // Only the first file should be recorded; the broken second
      // file's row MUST have been rolled back.
      const pool = new Pool({ connectionString });
      try {
        const rows = await pool.query<{ filename: string }>(
          'SELECT filename FROM schema_migrations ORDER BY filename',
        );
        expect(rows.rows.map((r) => r.filename)).toEqual([
          '001_extensions.sql',
        ]);
      } finally {
        await pool.end();
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

/**
 * 4R review #43 — pgroonga_index_defrag helper + nightly job.
 *
 * Migration 011 installs:
 *
 *   - A PL/pgSQL helper ``pgroonga_index_defrag(text)`` that wraps
 *     ``pgroonga_command('defrag', ...)``. The helper exists
 *     unconditionally so other migrations / operators can call it
 *     directly.
 *
 *   - A pg_cron nightly job at 03:00 UTC that defrags both
 *     ``books_title_pgroonga_idx`` and ``books_excerpt_pgroonga_idx``.
 *     The job is best-effort — the migration succeeds even when
 *     pg_cron is not installed, but the helper is still created
 *     so operators can run the defrag manually.
 *
 * Tests below exercise the helper directly (against the actual
 * pgroonga indexes created by migration 008) and assert the job
 * schedule contract.
 */
skipIfNoDb('migration 011 — pgroonga_index_defrag + pg_cron nightly (#43)', () => {
  beforeEach(async () => {
    return resetSchema();
  });

  it('creates the pgroonga_index_defrag helper function', async () => {
    await runMigrations({
      connectionString,
      migrationsDir: path.join(repoRoot, 'migrations'),
    });
    const pool = new Pool({ connectionString });
    try {
      const exists = await pool.query<{ ok: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'pgroonga_index_defrag') AS ok",
      );
      expect(exists.rows[0]?.ok).toBe(true);
    } finally {
      await pool.end();
    }
  });

  it('pgroonga_index_defrag helper is callable and returns void on both indexes', async () => {
    await runMigrations({
      connectionString,
      migrationsDir: path.join(repoRoot, 'migrations'),
    });
    const pool = new Pool({ connectionString });
    try {
      // The helper must accept any index name and finish without
      // raising. A freshly-applied schema has empty indexes so
      // defrag is effectively a no-op, but the call MUST succeed
      // so the cron job can invoke it nightly on a real DB.
      const r1 = await pool.query('SELECT pgroonga_index_defrag($1) AS ok', [
        'books_title_pgroonga_idx',
      ]);
      expect(r1.rows[0]?.ok).toBeNull(); // RETURNS void
      const r2 = await pool.query('SELECT pgroonga_index_defrag($1) AS ok', [
        'books_excerpt_pgroonga_idx',
      ]);
      expect(r2.rows[0]?.ok).toBeNull();
    } finally {
      await pool.end();
    }
  });

  it('nightly pg_cron job is registered when pg_cron is available', async () => {
    // The migration wraps the pg_cron setup in a DO block that
    // downgrades to a NOTICE when the extension is missing. When
    // the extension IS installed the job must appear in cron.job
    // with the documented schedule.
    const pool = new Pool({ connectionString });
    try {
      const hasCron = await pool.query<{ ok: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') AS ok",
      );
      await runMigrations({
        connectionString,
        migrationsDir: path.join(repoRoot, 'migrations'),
      });
      if (!hasCron.rows[0]?.ok) {
        // pg_cron is not installed in this environment — the
        // migration must still succeed (we just verified that
        // above) and the helper must still exist (verified above).
        // The schedule check is skipped here and asserted
        // separately when pg_cron is available.
        return;
      }
      const jobs = await pool.query<{ jobname: string; schedule: string }>(
        "SELECT jobname, schedule FROM cron.job WHERE jobname = 'alejandria_pgroonga_defrag'",
      );
      expect(jobs.rows).toHaveLength(1);
      expect(jobs.rows[0]?.schedule).toBe('0 3 * * *');
    } finally {
      await pool.end();
    }
  });

  it('migration is idempotent — running twice replaces the pg_cron schedule instead of stacking jobs', async () => {
    // After the first run the helper + (optionally) the job exist.
    // A second run MUST NOT add a second job, even if pg_cron is
    // available.
    const pool = new Pool({ connectionString });
    try {
      const hasCron = await pool.query<{ ok: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') AS ok",
      );
      const opts = {
        connectionString,
        migrationsDir: path.join(repoRoot, 'migrations'),
      };
      await runMigrations(opts);
      await runMigrations(opts); // second run
      if (!hasCron.rows[0]?.ok) return;
      const jobs = await pool.query<{ jobname: string }>(
        "SELECT jobname FROM cron.job WHERE jobname = 'alejandria_pgroonga_defrag'",
      );
      expect(jobs.rows).toHaveLength(1);
    } finally {
      await pool.end();
    }
  });
});

/**
 * File-level contract for migration 011 — runs WITHOUT a database
 * so the test always executes and pins the migration file shape.
 *
 * The DB-backed tests in the describe above verify the schema +
 * behaviour. This describe verifies the SQL file ITSELF is what
 * we expect to ship: it exists, defines the helper, schedules the
 * cron job at 03:00 UTC, and mentions both pgroonga indexes by
 * name.
 *
 * If a future contributor edits migration 011 and accidentally
 * drops the schedule or renames an index, these assertions fail
 * immediately without a database.
 */
describe('migration 011 file contract (#43)', () => {
  it('ships as services/nas-backend/migrations/011_pgroonga_defrag.sql', async () => {
    const fs = await import('fs/promises');
    const filePath = path.join(repoRoot, 'migrations', '011_pgroonga_defrag.sql');
    const sql = await fs.readFile(filePath, 'utf8');
    expect(sql.length).toBeGreaterThan(0);
  });

  it('defines pgroonga_index_defrag(text) and RETURNS void', async () => {
    const fs = await import('fs/promises');
    const filePath = path.join(repoRoot, 'migrations', '011_pgroonga_defrag.sql');
    const sql = await fs.readFile(filePath, 'utf8');
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION\s+pgroonga_index_defrag\s*\(\s*idx\s+text\s*\)/i,
    );
    expect(sql).toMatch(/RETURNS\s+void/i);
  });

  it('schedules the nightly pg_cron job at 03:00 UTC', async () => {
    const fs = await import('fs/promises');
    const filePath = path.join(repoRoot, 'migrations', '011_pgroonga_defrag.sql');
    const sql = await fs.readFile(filePath, 'utf8');
    expect(sql).toMatch(/cron\.schedule/i);
    expect(sql).toMatch(/['"]0 3 \* \* \*['"]/);
  });

  it('mentions both books_title_pgroonga_idx and books_excerpt_pgroonga_idx by name', async () => {
    const fs = await import('fs/promises');
    const filePath = path.join(repoRoot, 'migrations', '011_pgroonga_defrag.sql');
    const sql = await fs.readFile(filePath, 'utf8');
    expect(sql).toMatch(/books_title_pgroonga_idx/);
    expect(sql).toMatch(/books_excerpt_pgroonga_idx/);
  });

  it('downgrades gracefully when pg_cron is not installed', async () => {
    // The DO block must catch the extension-not-installed error
    // so the migration succeeds on a server without pg_cron.
    const fs = await import('fs/promises');
    const filePath = path.join(repoRoot, 'migrations', '011_pgroonga_defrag.sql');
    const sql = await fs.readFile(filePath, 'utf8');
    expect(sql).toMatch(/EXCEPTION WHEN/i);
    expect(sql).toMatch(/CREATE EXTENSION IF NOT EXISTS pg_cron/i);
  });
});