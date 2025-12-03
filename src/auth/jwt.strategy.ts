import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: true, // Ignorar expiración por ahora
      secretOrKey: 'wSddeEwq2e', // Mismo secret que Authoriza
    });
  }

  async validate(payload: any) {
    // Validación básica del payload
    if (payload && (payload.sub || payload.id)) {
      return {
        userId: payload.sub || payload.id,
        username: payload.username || payload.strUserName,
        email: payload.email
      };
    }
    throw new UnauthorizedException('Token inválido');
  }
}