import { createParamDecorator, ExecutionContext, Injectable, CanActivate, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Role } from './enums';

export interface AuthUser {
  sub: string;
  orgId: string;
  branchId: string | null; // null = organization-wide user
  role: Role;
}

export const jwtSecret = () => {
  const s = process.env.JWT_SECRET;
  if (!s && process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET is required');
  return s ?? 'dev-secret';
};
export const jwtRefreshSecret = () => {
  const s = process.env.JWT_REFRESH_SECRET;
  if (!s && process.env.NODE_ENV === 'production') throw new Error('JWT_REFRESH_SECRET is required');
  return s ?? 'dev-refresh-secret';
};

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!roles || roles.length === 0) return true;
    const user: AuthUser = ctx.switchToHttp().getRequest().user;
    return !!user && roles.includes(user.role);
  }
}
