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
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { JwtAuthGuard, JwtAuthRequest } from '../auth/jwt-auth.guard';
import {
  CreateLibraryInput,
  LibrariesService,
  LibraryDto,
  toLibraryDto,
  UpdateLibraryInput,
} from './libraries.service';
import { ApiValidationResponse } from '../common/openapi.decorators';

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
@ApiTags('libraries')
@ApiBearerAuth('bearer')
@Controller({ path: 'api/libraries', version: undefined })
@UseGuards(JwtAuthGuard)
export class LibrariesController {
  constructor(private readonly librariesService: LibrariesService) {}

  @Get()
  @ApiOperation({
    summary: 'List all libraries',
    description:
      'Returns every library the device-pair knows about. Bearer required.',
  })
  @ApiOkResponse({ description: 'List of libraries' })
  @ApiUnauthorizedResponse()
  list(): Promise<LibraryDto[]> {
    return this.librariesService.list().then((rows) => rows.map(toLibraryDto));
  }

  @Post()
  @ApiOperation({
    summary: 'Create a new library',
    description:
      'Registers a folder as a library rooted at `root_path`. The paired device becomes the library creator (used for PATCH/DELETE authorisation).',
  })
  @ApiBody({
    description: 'Library fields',
    schema: {
      example: {
        name: 'Seba’s reference library',
        root_path: '/Volumes/NAS/books',
      },
    },
  })
  @ApiCreatedResponse({ description: 'Library created' })
  @ApiUnauthorizedResponse()
  @ApiValidationResponse()
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
  @ApiOperation({ summary: 'Get a library by id' })
  @ApiOkResponse({ description: 'Library detail' })
  @ApiUnauthorizedResponse()
  @ApiNotFoundResponse()
  async detail(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<LibraryDto> {
    const row = await this.librariesService.getById(id);
    return toLibraryDto(row);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update library fields (creator-only)',
    description:
      'Updates one or both of `name` / `root_path`. Only the creator can PATCH; non-creators get 403.',
  })
  @ApiBody({
    description: 'Partial update — both fields are optional',
    schema: {
      example: {
        name: 'Seba’s reference library (renamed)',
        root_path: '/Volumes/NAS/books',
      },
    },
  })
  @ApiOkResponse({ description: 'Library updated' })
  @ApiUnauthorizedResponse()
  @ApiForbiddenResponse()
  @ApiNotFoundResponse()
  @ApiValidationResponse()
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
  @ApiOperation({
    summary: 'Delete a library (creator-only, must be empty)',
    description:
      'Only the creator can DELETE. The library must be empty of indexed books — otherwise the service throws 409 LIBRARY_NOT_EMPTY.',
  })
  @ApiNoContentResponse({ description: 'Library deleted' })
  @ApiUnauthorizedResponse()
  @ApiForbiddenResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse()
  async delete(
    @Req() req: JwtAuthRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    const deviceId = this.deviceIdFromRequest(req);
    await this.librariesService.delete(deviceId, id);
  }

  @Put(':id/active')
  @ApiOperation({
    summary: 'Activate a library for the paired device',
    description:
      'Marks the library as the device’s active one. Used for per-device "current library" state.',
  })
  @ApiOkResponse({ description: 'Active library set' })
  @ApiUnauthorizedResponse()
  @ApiNotFoundResponse()
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
