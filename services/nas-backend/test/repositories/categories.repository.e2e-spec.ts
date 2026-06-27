import {
  CategoriesRepository,
  createCategoriesRepository,
  Category,
} from '../../src/repositories/categories.repository';
import { DATABASE_URL, resetAndMigrate } from './_fixtures';

/**
 * Contract tests for ``CategoriesRepository``.
 *
 * The category tree is recursive (``parent_id`` self-reference) and
 * the repository exposes a ``findSubtree`` method that walks the
 * tree from a given root path via a recursive CTE. These tests pin
 * the expected behaviour: the root must be returned alongside every
 * descendant at any depth.
 */

const hasDb = !!process.env.DATABASE_URL;
const describeDb = hasDb ? describe : describe.skip;

describeDb('CategoriesRepository', () => {
  const repo: CategoriesRepository = createCategoriesRepository({
    connectionString: DATABASE_URL,
  });

  beforeEach(async () => {
    await resetAndMigrate(__dirname);
  });

  afterAll(async () => {
    await repo.close();
  });

  it('inserts a category and finds it by path', async () => {
    const inserted = await repo.insert({
      path: '/test-cat',
      nameEs: 'Cat ES',
      nameEn: 'Cat EN',
      depth: 0,
    });
    expect(inserted.id).toBeGreaterThan(0);

    const found = await repo.findByPath('/test-cat');
    expect(found).not.toBeNull();
    expect(found?.nameEs).toBe('Cat ES');
    expect(found?.nameEn).toBe('Cat EN');
    expect(found?.depth).toBe(0);
  });

  it('returns null from findByPath when no such category exists', async () => {
    const found = await repo.findByPath('/missing');
    expect(found).toBeNull();
  });

  it('lists immediate children of a category', async () => {
    const root = await repo.insert({
      path: '/test-tree',
      nameEs: 'Tree',
      nameEn: 'Tree',
      depth: 0,
    });
    await repo.insert({
      path: '/test-tree/a',
      nameEs: 'A',
      nameEn: 'A',
      parentId: root.id,
      depth: 1,
    });
    await repo.insert({
      path: '/test-tree/b',
      nameEs: 'B',
      nameEn: 'B',
      parentId: root.id,
      depth: 1,
    });
    // Unrelated root with its own children — must not appear.
    const otherRoot = await repo.insert({
      path: '/test-other',
      nameEs: 'Other',
      nameEn: 'Other',
      depth: 0,
    });
    await repo.insert({
      path: '/test-other/x',
      nameEs: 'X',
      nameEn: 'X',
      parentId: otherRoot.id,
      depth: 1,
    });

    const kids = await repo.listChildren(root.id);
    expect(kids).toHaveLength(2);
    const paths = kids.map((c) => c.path).sort();
    expect(paths).toEqual(['/test-tree/a', '/test-tree/b']);
  });

  it('findSubtree returns root + every descendant via recursive CTE', async () => {
    // Tree (under a prefix that does NOT collide with the seed
    // categories from migration 009):
    //   /test-cte
    //     /test-cte/a
    //       /test-cte/a/aa
    //         /test-cte/a/aa/aaa
    //     /test-cte/b
    //   /test-sibling (MUST NOT be returned)
    const root = await repo.insert({
      path: '/test-cte',
      nameEs: 'CTE',
      nameEn: 'CTE',
      depth: 0,
    });
    const child = await repo.insert({
      path: '/test-cte/a',
      nameEs: 'A',
      nameEn: 'A',
      parentId: root.id,
      depth: 1,
    });
    await repo.insert({
      path: '/test-cte/a/aa',
      nameEs: 'AA',
      nameEn: 'AA',
      parentId: child.id,
      depth: 2,
    });
    await repo.insert({
      path: '/test-cte/a/aa/aaa',
      nameEs: 'AAA',
      nameEn: 'AAA',
      parentId: child.id,
      depth: 3,
    });
    await repo.insert({
      path: '/test-cte/b',
      nameEs: 'B',
      nameEn: 'B',
      parentId: root.id,
      depth: 1,
    });
    await repo.insert({
      path: '/test-sibling',
      nameEs: 'Sib',
      nameEn: 'Sib',
      depth: 0,
    });

    const subtree = await repo.findSubtree('/test-cte');
    const paths = subtree.map((c: Category) => c.path).sort();
    expect(paths).toEqual([
      '/test-cte',
      '/test-cte/a',
      '/test-cte/a/aa',
      '/test-cte/a/aa/aaa',
      '/test-cte/b',
    ]);
  });

  it('findSubtree returns just the root when no descendants exist', async () => {
    await repo.insert({
      path: '/test-lone',
      nameEs: 'Lone',
      nameEn: 'Lone',
      depth: 0,
    });
    const subtree = await repo.findSubtree('/test-lone');
    expect(subtree).toHaveLength(1);
    expect(subtree[0].path).toBe('/test-lone');
  });

  it('findSubtree returns empty array when root path is missing', async () => {
    await repo.insert({
      path: '/test-lone2',
      nameEs: 'Lone2',
      nameEn: 'Lone2',
      depth: 0,
    });
    const subtree = await repo.findSubtree('/no-existe');
    expect(subtree).toEqual([]);
  });
});