import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(authService) {
    this.authService = authService;
  }

  // POST /auth/login
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() body) {
    return this.authService.login(body);
  }

  // POST /auth/register
  @Post('register')
  register(@Body() body) {
    return this.authService.register(body);
  }
}
