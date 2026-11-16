import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { IsEmail, IsEnum, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import { Repository } from 'typeorm';
import { AuthUser, CurrentUser, JwtAuthGuard, Roles, RolesGuard } from '../common/auth';
import { ORG_WIDE_ROLES, Role } from '../common/enums';
import { Branch } from '../entities/branch.entity';
import { User } from '../entities/user.entity';

class CreateUserDto {
  @IsString() name: string;
  @IsEmail() email: string;
  @IsString() @MinLength(8) password: string;
  @IsEnum(Role) role: Role;
  @IsOptional() @IsUUID() branchId?: string;
}

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(Branch) private branches: Repository<Branch>,
  ) {}

  @Get() @Roles(Role.OWNER, Role.ADMIN)
  list(@CurrentUser() u: AuthUser) {
    return this.users.find({
      where: u.branchId ? { organizationId: u.orgId, branchId: u.branchId } : { organizationId: u.orgId },
      order: { name: 'ASC' },
    });
  }

  @Post() @Roles(Role.OWNER, Role.ADMIN)
  async create(@CurrentUser() u: AuthUser, @Body() dto: CreateUserDto) {
    const orgWide = ORG_WIDE_ROLES.includes(dto.role);
    if (u.role === Role.ADMIN && dto.role === Role.OWNER) {
      throw new ForbiddenException('Only an owner can create another owner');
    }
    if (!orgWide && !dto.branchId) throw new BadRequestException('branchId is required for branch-level roles');
    if (dto.branchId && !(await this.branches.exist({ where: { id: dto.branchId, organizationId: u.orgId } }))) {
      throw new BadRequestException('Unknown branch');
    }
    if (await this.users.exist({ where: { email: dto.email.toLowerCase() } })) throw new BadRequestException('Email already in use');
    const saved = await this.users.save(
      this.users.create({
        organizationId: u.orgId,
        branchId: orgWide ? null : dto.branchId,
        name: dto.name,
        email: dto.email.toLowerCase(),
        passwordHash: await bcrypt.hash(dto.password, 10),
        role: dto.role,
      }),
    );
    const { passwordHash, refreshTokenHash, ...safe } = saved as any;
    return safe;
  }
}
