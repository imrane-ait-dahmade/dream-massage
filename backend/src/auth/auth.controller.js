import { Controller, Post, HttpCode, HttpStatus, Dependencies, Req } from '@nestjs/common';
import { AuthService } from './auth.service';

// NOTE: @Body() parameter decorators are TypeScript-only and incompatible with Babel.
// Body is extracted manually from the request object until backend/ is migrated to TypeScript.
@Controller('auth')
@Dependencies(AuthService)
export class AuthController {
  constructor(authService) {
    this.authService = authService;
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(req) {
    return this.authService.login(req.body ?? {});
  }

  @Post('register')
  async register(req) {
    return this.authService.register(req.body ?? {});
  }
}
