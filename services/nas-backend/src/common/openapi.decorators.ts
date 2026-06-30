import { ApiResponse } from '@nestjs/swagger';
import type { ApiResponseOptions } from '@nestjs/swagger';

/**
 * Shared OpenAPI response decorators for the four response codes
 * the NAS backend uses across every controller.
 *
 * PR-N6 (issue #90) standardises the wire shape behind these
 * envelopes. Centralising the decorators here keeps the error
 * documentation stable: every endpoint that returns 401 cites the
 * ``UNAUTHORIZED`` envelope, every 403 cites ``FORBIDDEN``, every
 * 429 cites ``THROTTLED`` — so the generated TS SDK can rely on
 * ``error.code`` rather than parsing free-form messages.
 */

const ERROR_ENVELOPE_DESCRIPTION =
  'Standard error envelope: { error: { code, message, details? } }. Stable `code` strings: UNAUTHORIZED, TOKEN_INVALID, TOKEN_EXPIRED, BAD_PIN, NOT_FOUND, FORBIDDEN, VALIDATION_FAILED, THROTTLED, LIBRARY_NOT_EMPTY.';

/**
 * 401 — missing/malformed bearer token OR ``JwtAuthGuard``
 * rejects the credential.
 */
export function ApiUnauthorizedResponse(): MethodDecorator {
  return ApiResponse({
    status: 401,
    description: 'Missing or invalid bearer token',
    schema: {
      example: {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Missing Bearer token',
        },
      },
    },
  });
}

/**
 * 403 — paired but not authorised (e.g. non-admin trying to use an
 * admin-only endpoint, or device that didn't create the library
 * trying to PATCH/DELETE it).
 */
export function ApiForbiddenResponse(): MethodDecorator {
  return ApiResponse({
    status: 403,
    description: 'The authenticated device lacks the required permission',
    schema: {
      example: {
        error: {
          code: 'FORBIDDEN',
          message: 'Only the creator can modify this resource',
        },
      },
    },
  });
}

/**
 * 404 — resource lookup failed.
 */
export function ApiNotFoundResponse(): MethodDecorator {
  return ApiResponse({
    status: 404,
    description: 'Resource not found',
    schema: {
      example: {
        error: {
          code: 'NOT_FOUND',
          message: 'Requested resource does not exist',
        },
      },
    },
  });
}

/**
 * 409 — state conflict (e.g. library is not empty on DELETE).
 */
export function ApiConflictResponse(): MethodDecorator {
  return ApiResponse({
    status: 409,
    description:
      'Requested action conflicts with the current resource state',
    schema: {
      example: {
        error: {
          code: 'LIBRARY_NOT_EMPTY',
          message: 'Cannot delete a library that still holds indexed books',
        },
      },
    },
  });
}

/**
 * 422 — DTO validation failure.
 */
export function ApiValidationResponse(): MethodDecorator {
  return ApiResponse({
    status: 422,
    description: 'Request payload failed validation against the DTO',
    schema: {
      example: {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Request payload failed validation',
          details: [
            { field: 'library_id', constraints: ['must be an integer >= 1'] },
          ],
        },
      },
    },
  });
}

/**
 * 429 — throttled. Carries the project's ``THROTTLED`` envelope
 * (4R review #34).
 */
export function ApiThrottledResponse(): MethodDecorator {
  return ApiResponse({
    status: 429,
    description: 'Too many requests, please try again later',
    schema: {
      example: {
        error: {
          code: 'THROTTLED',
          message: 'Too many requests, please try again later',
        },
      },
    },
  });
}

/**
 * 503 — service unavailable (currently only used by the health
 * probes when Postgres is unreachable).
 */
export function ApiServiceUnavailableResponse(
  options: Pick<ApiResponseOptions, 'description'> = {},
): MethodDecorator {
  return ApiResponse({
    status: 503,
    description: options.description ?? 'Service is currently unavailable',
    schema: {
      example: {
        status: 'error',
        timestamp: '2026-06-30T00:00:00.000Z',
        version: '1.0.0',
        checks: { db: { ok: false, error: 'connection refused' } },
      },
    },
  });
}

/** Re-export of the envelope description for callers that want it. */
export const ERROR_ENVELOPE = ERROR_ENVELOPE_DESCRIPTION;
