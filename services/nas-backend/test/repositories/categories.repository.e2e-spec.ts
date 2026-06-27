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
      path: '/ciencia',
      nameEs: 'Ciencia',
      nameEn: 'Science',
      depth: 0,
    });
    expect(inserted.id).toBeGreaterThan(0);

    const found = await repo.findByPath('/ciencia');
    expect(found).not.toBeNull();
    expect(found?.nameEs).toBe('Ciencia');
    expect(found?.nameEn).toBe('Science');
    expect(found?.depth).toBe(0);
  });

  it('returns null from findByPath when no such category exists', async () => {
    const found = await repo.findByPath('/missing');
    expect(found).toBeNull();
  });

  it('lists immediate children of a category', async () => {
    const ciencia = await repo.insert({
      path: '/ciencia',
      nameEs: 'Ciencia',
      nameEn: 'Science',
      depth: 0,
    });
    await repo.insert({
      path: '/ciencia/biologia',
      nameEs: 'Biología',
      nameEn: 'Biology',
      parentId: ciencia.id,
      depth: 1,
    });
    await repo.insert({
      path: '/ciencia/quimica',
      nameEs: 'Química',
      nameEn: 'Chemistry',
      parentId: ciencia.id,
      depth: 1,
    });
    // Unrelated root with its own children — must not appear.
    const arte = await repo.insert({
      path: '/arte',
      nameEs: 'Arte',
      nameEn: 'Art',
      depth: 0,
    });
    await repo.insert({
      path: '/arte/pintura',
      nameEs: 'Pintura',
      nameEn: 'Painting',
      parentId: arte.id,
      depth: 1,
    });

    const kids = await repo.listChildren(ciencia.id);
    expect(kids).toHaveLength(2);
    const paths = kids.map((c) => c.path).sort();
    expect(paths).toEqual(['/ciencia/biologia', '/ciencia/quimica']);
  });

  it('findSubtree returns root + every descendant via recursive CTE', async () => {
    // Tree:
    //   /ciencia
    //     /ciencia/biologia
    //       /ciencia/biologia/zoologia
    //         /ciencia/biologia/zoologia/mamiferos
    //     /ciencia/quimica
    //   /arte   (sibling, MUST NOT be returned)
    const ciencia = await repo.insert({
      path: '/ciencia',
      nameEs: 'Ciencia',
      nameEn: 'Science',
      depth: 0,
    });
    const biologia = await repo.insert({
      path: '/ciencia/biologia',
      nameEs: 'Biología',
      nameEn: 'Biology',
      parentId: ciencia.id,
      depth: 1,
    });
    await repo.insert({
      path: '/ciencia/biologia/zoologia',
      nameEs: 'Zoología',
      nameEn: 'Zoology',
      parentId: biologia.id,
      depth: 2,
    });
    await repo.insert({
      path: '/ciencia/biologia/zoologia/mamiferos',
      nameEs: 'Mamíferos',
      nameEn: 'Mammals',
      parentId: biologia.id,
      depth: 3,
    });
    await repo.insert({
      path: '/ciencia/quimica',
      nameEs: 'Química',
      nameEn: 'Chemistry',
      parentId: ciencia.id,
      depth: 1,
    });
    await repo.insert({
      path: '/arte',
      nameEs: 'Arte',
      nameEn: 'Art',
      depth: 0,
    });

    const subtree = await repo.findSubtree('/ciencia');
    const paths = subtree.map((c: Category) => c.path).sort();
    expect(paths).toEqual([
      '/ciencia',
      '/ciencia/biologia',
      '/ciencia/biologia/zoologia',
      '/ciencia/biologia/zoologia/mamiferos',
      '/ciencia/quimica',
    ]);
  });

  it('findSubtree returns just the root when no descendants exist', async () => {
    await repo.insert({
      path: '/solitario',
      nameEs: 'Solitario',
      nameEn: 'Lone',
      depth: 0,
    });
    const subtree = await repo.findSubtree('/solitario');
    expect(subtree).toHaveLength(1);
    expect(subtree[0].path).toBe('/solitario');
  });

  it('findSubtree returns empty array when root path is missing', async () => {
    await repo.insert({
      path: '/ciencia',
      nameEs: 'Ciencia',
      nameEn: 'Science',
      depth: 0,
    });
    const subtree = await repo.findSubtree('/no-existe');
    expect(subtree).toEqual([]);
  });
});