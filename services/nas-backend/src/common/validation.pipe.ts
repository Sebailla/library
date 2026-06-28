import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';
import { Response } from 'express';

/**
 * Project-wide {@link ValidationPipe} factory — 4R review #41.
 *
 * Every DTO failure MUST surface the same envelope the rest of the
 * API uses:
 *
 *   {
 *     error: {
 *       code: 'VALIDATION_FAILED',
 *       message: '...',
 *       details: Array<{ field: string; constraints: string[] }>,
 *     }
 *   }
 *
 * Without this, NestJS' default validation error is the legacy
 * ``{ statusCode, message: string[], error: 'Bad Request' }`` shape,
 * which violates the 4R contract (clients already branch on
 * ``error.code === 'BAD_PIN'`` / ``'TOKEN_INVALID'`` / ``'NOT_FOUND'`` /
 * ``'THROTTLED'``).
 *
 * The pipe is registered via {@link APP_PIPE} in ``AppModule`` so the
 * exceptionFactory is shared by every test bootstrapped from
 * ``Test.createTestingModule({ imports: [AppModule] })`` — including
 * the search.e2e-spec and downloads.e2e-spec suites that previously
 * called ``useGlobalPipes(new ValidationPipe(...))`` locally with the
 * default factory.
 */
export function buildValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
    stopAtFirstError: false,
    exceptionFactory: (errors: ValidationError[]) => {
      const details = flattenValidationErrors(errors);
      return new BadRequestException({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Request payload failed validation',
          details,
        },
      });
    },
  });
}

/**
 * Flatten the tree-shaped {@link ValidationError}s into the
 * project-standard ``{ field, constraints }`` rows. Nested DTOs are
 * joined with ``.`` so the client can address the failing leaf
 * unambiguously (e.g. ``foo.bar`` rather than the ambiguous
 * ``bar``).
 */
export function flattenValidationErrors(
  errors: ValidationError[],
  parentPath = '',
): Array<{ field: string; constraints: string[] }> {
  const rows: Array<{ field: string; constraints: string[] }> = [];
  for (const err of errors) {
    const field = parentPath ? `${parentPath}.${err.property}` : err.property;
    if (err.constraints) {
      rows.push({
        field,
        constraints: Object.values(err.constraints),
      });
    }
    if (err.children && err.children.length > 0) {
      rows.push(...flattenValidationErrors(err.children, field));
    }
  }
  return rows;
}

/**
 * Catch-all filter for {@link HttpException}s that escape Nest's
 * built-in handling — used as a safety net to make sure the
 * ``{ error: { code, message } }`` shape is the single client-
 * facing envelope. Without it, anything not handled by a more
 * specific filter (or by the global pipe) would leak the legacy
 * ``{ statusCode, message, error }`` shape.
 */
@Catch(HttpException)
export class HttpEnvelopeFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpEnvelopeFilter');

  catch(exception: HttpException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();
    const body = exception.getResponse();

    // If the pipe (or another producer) already emitted the project
    // envelope, pass it through unchanged.
    if (
      typeof body === 'object' &&
      body !== null &&
      'error' in body &&
      typeof (body as { error?: unknown }).error === 'object' &&
      (body as { error?: { code?: unknown } }).error !== null &&
      typeof (body as { error: { code?: unknown } }).error.code === 'string'
    ) {
      response.status(status).json(body);
      return;
    }

    // Otherwise derive a stable code from the HTTP status so the
    // client can still branch on ``error.code``.
    const code = httpStatusToCode(status);
    const message =
      typeof body === 'object' && body !== null && 'message' in body
        ? String((body as { message?: unknown }).message)
        : exception.message;
    this.logger.warn(
      `HttpException(${status}) without project envelope — wrapping as ${code}`,
    );
    response.status(status).json({
      error: { code, message },
    });
  }
}

function httpStatusToCode(status: number): string {
  switch (status) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 422:
      return 'UNPROCESSABLE_ENTITY';
    case 429:
      return 'THROTTLED';
    default:
      return status >= 500 ? 'INTERNAL_ERROR' : 'CLIENT_ERROR';
  }
}