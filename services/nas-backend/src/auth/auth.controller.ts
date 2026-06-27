import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
} from '@nestjs/common';
import { IsString, Length, Matches } from 'class-validator';
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
 */
@Controller({ path: 'api/auth', version: undefined })
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('pair')
  @HttpCode(HttpStatus.CREATED)
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
  async refresh(@Body() body: RefreshDto): Promise<TokenResponse> {
    const issued = await this.authService.refresh({ token: body.token });
    return {
      token: issued.token,
      expires_at: issued.expiresAt,
      device_id: issued.deviceId,
    };
  }
}
