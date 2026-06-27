import { Inject, Injectable } from '@nestjs/common';
import {
  CATEGORIES_REPOSITORY,
  CategoriesRepository,
  Category,
} from './categories.repository';

/** Item shape for ``GET /api/categories``. */
export interface CategoryDto {
  id: number;
  path: string;
  parent_id: number | null;
  depth: number;
  name_es: string;
  name_en: string;
  children: CategoryDto[];
}

/** Response shape for ``GET /api/categories``. */
export interface ListCategoriesResponse {
  data: CategoryDto[];
}

/**
 * Categories service — backs ``GET /api/categories``.
 *
 * Returns the top-level categories as a nested tree where each node
 * carries its ``children`` populated recursively. Uses
 * {@link CategoriesRepository.findSubtree} per root so each sub-tree
 * is fetched with a single recursive CTE instead of one query per
 * level.
 */
@Injectable()
export class CategoriesService {
  constructor(
    @Inject(CATEGORIES_REPOSITORY)
    private readonly categories: CategoriesRepository,
  ) {}

  async listTree(): Promise<ListCategoriesResponse> {
    const roots = await this.categories.listRoots();
    const data = await Promise.all(
      roots.map(async (root) => this.expandSubtree(root)),
    );
    return { data };
  }

  private async expandSubtree(root: Category): Promise<CategoryDto> {
    const flat = await this.categories.findSubtree(root.path);
    const byPath = new Map<string, CategoryDto>();
    // Pre-populate with all nodes.
    for (const row of flat) {
      byPath.set(row.path, toCategoryDto(row, []));
    }
    // Wire children → parents. ``flat`` is sorted by path ASC so
    // parents always appear before their descendants.
    for (const row of flat) {
      const node = byPath.get(row.path);
      if (!node) continue;
      if (row.parentId !== null) {
        const parent = findParent(byPath, row.parentId);
        if (parent) parent.children.push(node);
      }
    }
    // The tree root is the entry returned by ``listRoots``.
    return byPath.get(root.path) ?? toCategoryDto(root, []);
  }
}

function toCategoryDto(row: Category, children: CategoryDto[]): CategoryDto {
  return {
    id: row.id,
    path: row.path,
    parent_id: row.parentId,
    depth: row.depth,
    name_es: row.nameEs,
    name_en: row.nameEn,
    children,
  };
}

function findParent(
  byPath: Map<string, CategoryDto>,
  parentId: number,
): CategoryDto | undefined {
  for (const node of byPath.values()) {
    if (node.id === parentId) return node;
  }
  return undefined;
}