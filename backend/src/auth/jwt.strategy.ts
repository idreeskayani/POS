import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthUser, jwtSecret } from '../common/auth';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({ jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), secretOrKey: jwtSecret() });
  }
  validate(payload: AuthUser): AuthUser {
    return { sub: payload.sub, orgId: payload.orgId, branchId: payload.branchId, role: payload.role };
  }
}
