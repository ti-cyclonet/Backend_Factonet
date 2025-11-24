import { Controller, Get, UseGuards, Request, Query, Param } from '@nestjs/common';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  getProfile(@Request() req) {
    return req.user;
  }

  @UseGuards(JwtAuthGuard)
  @Get('validate')
  async validateToken(@Request() req) {
    return { valid: true, user: req.user };
  }

  @UseGuards(JwtAuthGuard)
  @Get('users')
  async getUsers(@Request() req, @Query('page') page = 1, @Query('limit') limit = 10) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    return this.authService.getUsers(token, page, limit);
  }

  @UseGuards(JwtAuthGuard)
  @Get('users/:id/access')
  async checkUserAccess(@Request() req, @Param('id') userId: string) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    return this.authService.checkUserAccess(token, userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('applications')
  async getApplications(@Request() req) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    return this.authService.getApplications(token);
  }
}