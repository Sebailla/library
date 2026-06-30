import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';
import {
  ApiUnauthorizedResponse,
  ApiThrottledResponse,
  ApiValidationResponse,
} from '../common/openapi.decorators';
import { AuthService } from './auth.service';

/** Body shape for ``POST /api/auth/pair``. */
export class PairDto {
  @IsString()
  @Length(4, 16)
  pin!: string;

  @IsString()
  @Length(1, 128)
  device_name!: string;
}

/** Body shape for ``POST /api/auth/refresh``. */
export class RefreshDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_.-]+\.[A-Za-z0-9_.-]+\.[A-Za-z0-9_.-]+$/)
  token!: string;
}

/**
 * Wire shape returned by pair + refresh.
 *
 * ``snake_case`` on the wire (``expires_at``, ``device_id``) so the
 * HTTP contract matches the rest of the NAS API surface and the
 * MVP client's existing parser. The service-side model is
 * camelCase; the controller flattens it before returning.
 */
export interface TokenResponse {
  token: string;
  expires_at: string;
  device_id: string;
}

/**
 * Auth endpoints — ``POST /api/auth/pair`` and
 * ``POST /api/auth/refresh``.
 *
 * Both endpoints are public — no Bearer token is required to call
 * them. Pair mints a new JWT; refresh rotates an existing one.
 *
 * Rate limits (#34, 4R review): pair is the bruteforce target so
 * its limit is tight (5/min/IP). refresh is legitimate but should
 * not be unbounded, so it is 10/min/IP. Both are documented in
 * ``test/throttler.e2e-spec.ts``.
 */
@ApiTags('auth')
@Controller({ path: 'api/auth', version: undefined })
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('pair')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Pair a new device (mint a JWT)',
    description:
      'Exchanges an 8-digit NAS PIN + device name for a short-lived JWT. Public endpoint — the device calls this BEFORE it has any token. Rate-limited to 5 attempts/min/IP (4R #34) because this is the bruteforce target.',
  })
  @ApiBody({
    description: 'Pair credentials',
    schema: {
      example: {
        pin: '12345678',
        device_name: "sebastian's MacBook Pro",
      },
    },
  })
  @ApiCreatedResponse({
    description: 'Paired — JWT returned',
    schema: {
      example: {
        token:
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIuLi4ifQ.signature',
        expires_at: '2026-06-30T01:00:00.000Z',
        device_id: '1f6c0d5f-...',
      },
    },
  })
  @ApiUnauthorizedResponse()
  @ApiValidationResponse()
  @ApiThrottledResponse()
  async pair(
    @Body() body: PairDto,
    @Ip() ip: string,
  ): Promise<TokenResponse> {
    const issued = await this.authService.pair({
      pin: body.pin,
      deviceName: body.device_name,
      ipAddress: ip,
    });
    return {
      token: issued.token,
      expires_at: issued.expiresAt,
      device_id: issued.deviceId,
    };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Rotate a JWT (refresh)',
    description:
      'Exchanges a near-expiry JWT for a fresh one (rotation). Rate-limited to 10/min/IP because the endpoint is legitimate but should not be unbounded.',
  })
  @ApiBody({
    description: 'Refresh credentials',
    schema: {
      example: {
        token:
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIuLi4ifQ.signature',
      },
    },
  })
  @ApiCreatedResponse({
    description: 'Refreshed — new JWT returned',
    schema: {
      example: {
        token:
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIuLi4ifQ.newSignature',
        expires_at: '2026-06-30T01:30:00.000Z',
        device_id: '1f6c0d5f-...',
      },
    },
  })
  @ApiUnauthorizedResponse()
  @ApiThrottledResponse()
  async refresh(@Body() body: RefreshDto): Promise<TokenResponse> {
    const issued = await this.authService.refresh({ token: body.token });
    return {
      token: issued.token,
      expires_at: issued.expiresAt,
      device_id: issued.deviceId,
    };
  }
}
