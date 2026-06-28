import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  CategoriesService,
  ListCategoriesResponse,
} from './categories.service';

/**
 * Categories HTTP route — PR-2D, work unit 3.
 *
 *   GET /api/categories    → CategoriesService.listTree
 *
 * Returns the full category tree with each root category carrying
 * its descendants under the ``children`` key. The route is
 * protected by ``JwtAuthGuard`` (PR-2C).
 */
@Controller({ path: 'api/categories', version: undefined })
@UseGuards(JwtAuthGuard)
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  list(): Promise<ListCategoriesResponse> {
    return this.categoriesService.listTree();
  }
}