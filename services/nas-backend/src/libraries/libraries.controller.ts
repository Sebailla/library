import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { JwtAuthGuard, JwtAuthRequest } from '../auth/jwt-auth.guard';
import {
  CreateLibraryInput,
  LibrariesService,
  LibraryDto,
  toLibraryDto,
  UpdateLibraryInput,
} from './libraries.service';

/**
 * Body for ``POST /api/libraries``. Snake-case to match the
 * rest of the API surface. ``name`` and ``root_path`` are
 * both required; the global ValidationPipe rejects empty
 * values with 400 before the service is called.
 */
class CreateLibraryBody {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  root_path!: string;
}

/**
 * Body for ``PATCH /api/libraries/:id``. Every field is
 * optional; the service layer rejects an empty patch so the
 * controller does not have to.
 */
class UpdateLibraryBody {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  root_path?: string;
}

/**
 * Multi-library HTTP routes — PR-N2.
 *
 *   GET    /api/libraries              → 200 LibraryDto[]
 *   POST   /api/libraries              → 201 LibraryDto
 *   GET    /api/libraries/:id          → 200 LibraryDto | 404 NOT_FOUND
 *   PATCH  /api/libraries/:id          → 200 | 403 FORBIDDEN | 404
 *   DELETE /api/libraries/:id          → 204 | 403 FORBIDDEN | 404 | 409 LIBRARY_NOT_EMPTY
 *   PUT    /api/libraries/:id/active   → 200 | 404
 *
 * Every route sits behind ``JwtAuthGuard``; the device that
 * paired the bearer token is the only entity that can PATCH
 * or DELETE a library it did not create. The service is the
 * authority on that rule — the controller stays a thin
 * transport adapter that converts wire bodies to the service
 * DTOs and back.
 */
@Controller({ path: 'api/libraries', version: undefined })
@UseGuards(JwtAuthGuard)
export class LibrariesController {
  constructor(private readonly librariesService: LibrariesService) {}

  @Get()
  list(): Promise<LibraryDto[]> {
    return this.librariesService.list().then((rows) => rows.map(toLibraryDto));
  }

  @Post()
  async create(
    @Req() req: JwtAuthRequest,
    @Body() body: CreateLibraryBody,
  ): Promise<LibraryDto> {
    const deviceId = this.deviceIdFromRequest(req);
    const input: CreateLibraryInput = {
      name: body.name,
      rootPath: body.root_path,
    };
    const row = await this.librariesService.create(deviceId, input);
    return toLibraryDto(row);
  }

  @Get(':id')
  async detail(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<LibraryDto> {
    const row = await this.librariesService.getById(id);
    return toLibraryDto(row);
  }

  @Patch(':id')
  async update(
    @Req() req: JwtAuthRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateLibraryBody,
  ): Promise<LibraryDto> {
    const deviceId = this.deviceIdFromRequest(req);
    const input: UpdateLibraryInput = {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.root_path !== undefined ? { rootPath: body.root_path } : {}),
    };
    const row = await this.librariesService.update(deviceId, id, input);
    return toLibraryDto(row);
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(
    @Req() req: JwtAuthRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    const deviceId = this.deviceIdFromRequest(req);
    await this.librariesService.delete(deviceId, id);
  }

  @Put(':id/active')
  async setActive(
    @Req() req: JwtAuthRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<LibraryDto> {
    const deviceId = this.deviceIdFromRequest(req);
    const result = await this.librariesService.setActive(deviceId, id);
    return toLibraryDto(result.library);
  }

  /**
   * Pull the paired device UUID from the request, throwing
   * 401 if the guard somehow let an unauthenticated request
   * through (it should not, but this keeps the controller
   * honest if a future refactor changes the guard ordering).
   */
  private deviceIdFromRequest(req: JwtAuthRequest): string {
    const id = req.device?.deviceId;
    if (!id) {
      throw new Error('JwtAuthGuard did not attach req.device');
    }
    return id;
  }
}
