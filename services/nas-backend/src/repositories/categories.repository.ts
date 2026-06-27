import { Pool } from 'pg';
import { buildPool } from '../database/pg.service';

/** Shape of a row in the ``categories`` table. */
export interface Category {
  id: number;
  path: string;
  nameEs: string;
  nameEn: string;
  parentId: number | null;
  depth: number;
  createdAt: Date;
}

/** Subset of {@link Category} accepted by ``insert``. */
export interface NewCategory {
  path: string;
  nameEs: string;
  nameEn: string;
  parentId?: number | null;
  depth?: number;
}

interface CategoryRow {
  id: string | number;
  path: string;
  name_es: string;
  name_en: string;
  parent_id: string | number | null;
  depth: number | string;
  created_at: Date;
}

function rowToCategory(row: CategoryRow): Category {
  return {
    id: Number(row.id),
    path: row.path,
    nameEs: row.name_es,
    nameEn: row.name_en,
    parentId: row.parent_id === null ? null : Number(row.parent_id),
    depth: Number(row.depth),
    createdAt: row.created_at,
  };
}

const COLUMNS =
  'id, path, name_es, name_en, parent_id, depth, created_at';

/** Repository contract for the ``categories`` table. */
export interface CategoriesRepository {
  insert(category: NewCategory): Promise<Category>;
  findByPath(path: string): Promise<Category | null>;
  listChildren(parentId: number): Promise<Category[]>;
  /** Return every root category (depth=0, parentId=NULL) ordered by path. */
  listRoots(): Promise<Category[]>;
  /**
   * Return the categories attached to a given book via the
   * ``book_categories`` bridge. Ordered by category path ASC so
   * the response is stable across calls.
   */
  listForBook(bookId: number): Promise<Category[]>;
  /**
   * Recursively expand the tree rooted at ``rootPath`` and return
   * every category in the sub-tree (root included). Uses a
   * ``WITH RECURSIVE`` CTE so it scales linearly with the sub-tree
   * size, not the total category count.
   */
  findSubtree(rootPath: string): Promise<Category[]>;
  close(): Promise<void>;
}

export class PgCategoriesRepository implements CategoriesRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async insert(category: NewCategory): Promise<Category> {
    const sql = `
      INSERT INTO categories (path, name_es, name_en, parent_id, depth)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING ${COLUMNS}
    `;
    const res = await this.pool.query<CategoryRow>(sql, [
      category.path,
      category.nameEs,
      category.nameEn,
      category.parentId ?? null,
      category.depth ?? 0,
    ]);
    return rowToCategory(res.rows[0]);
  }

  async findByPath(path: string): Promise<Category | null> {
    const res = await this.pool.query<CategoryRow>(
      `SELECT ${COLUMNS} FROM categories WHERE path = $1`,
      [path],
    );
    if (res.rowCount === 0) return null;
    return rowToCategory(res.rows[0]);
  }

  async listChildren(parentId: number): Promise<Category[]> {
    const res = await this.pool.query<CategoryRow>(
      `SELECT ${COLUMNS} FROM categories WHERE parent_id = $1 ORDER BY path ASC`,
      [parentId],
    );
    return res.rows.map(rowToCategory);
  }

  async listRoots(): Promise<Category[]> {
    const res = await this.pool.query<CategoryRow>(
      `SELECT ${COLUMNS} FROM categories WHERE parent_id IS NULL ORDER BY path ASC`,
    );
    return res.rows.map(rowToCategory);
  }

  async listForBook(bookId: number): Promise<Category[]> {
    const res = await this.pool.query<CategoryRow>(
      `SELECT c.id, c.path, c.name_es, c.name_en, c.parent_id, c.depth, c.created_at
       FROM categories c
       JOIN book_categories bc ON bc.category_id = c.id
       WHERE bc.book_id = $1
       ORDER BY c.path ASC`,
      [bookId],
    );
    return res.rows.map(rowToCategory);
  }

  async findSubtree(rootPath: string): Promise<Category[]> {
    // Anchor selects the root node by path; the recursive member
    // joins children whose ``parent_id`` matches an id already in
    // the working set. ``depth`` from the CTE tells us the depth
    // relative to the root, which the UI uses for indentation.
    const sql = `
      WITH RECURSIVE category_tree AS (
        SELECT id, path, name_es, name_en, parent_id, depth, created_at, 0 AS rel_depth
        FROM categories
        WHERE path = $1

        UNION ALL

        SELECT c.id, c.path, c.name_es, c.name_en, c.parent_id, c.depth, c.created_at, ct.rel_depth + 1
        FROM categories c
        JOIN category_tree ct ON c.parent_id = ct.id
      )
      SELECT ${COLUMNS}
      FROM category_tree
      ORDER BY path ASC
    `;
    const res = await this.pool.query<CategoryRow>(sql, [rootPath]);
    return res.rows.map(rowToCategory);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export interface CreateCategoriesRepositoryOptions {
  connectionString?: string;
  pool?: Pool;
}

export function createCategoriesRepository(
  options: CreateCategoriesRepositoryOptions = {},
): CategoriesRepository {
  const pool = options.pool ?? buildPool(options.connectionString);
  return new PgCategoriesRepository(pool);
}