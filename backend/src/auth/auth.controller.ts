import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../common/session';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register/customer')
  register(@Body() body: unknown) { return this.auth.register(body); }

  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.login(body);
    response.cookie('bistro_session', result.token, this.auth.cookieOptions());
    return result.user;
  }

  @Get('me')
  me(@Req() request: AuthenticatedRequest) { return this.auth.current(request); }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(request);
    response.clearCookie('bistro_session', this.auth.clearCookieOptions());
  }
}
