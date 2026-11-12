import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { DataSource, Repository } from 'typeorm';
import { AuthUser, jwtRefreshSecret, jwtSecret } from '../common/auth';
import { Role } from '../common/enums';
import { Branch } from '../entities/branch.entity';
import { Organization } from '../entities/organization.entity';
import { User } from '../entities/user.entity';

export interface RegisterOrgInput {
  orgName: string;
  branchName: string;
  branchCode: string;
  name: string;
  email: string;
  password: string;
}

@Injectable()
export class AuthService {
  constructor(
    private jwt: JwtService,
    private ds: DataSource,
    @InjectRepository(User) private users: Repository<User>,
  ) {}

  /** Bootstraps a new organization with its first branch and an OWNER account. */
  async registerOrg(dto: RegisterOrgInput) {
    const email = dto.email.toLowerCase();
    if (await this.users.exist({ where: { email } })) throw new ConflictException('Email already in use');
    const user = await this.ds.transaction(async (m) => {
      const org = await m.save(m.create(Organization, { name: dto.orgName }));
      await m.save(m.create(Branch, { organizationId: org.id, name: dto.branchName, code: dto.branchCode }));
      return m.save(
        m.create(User, {
          organizationId: org.id,
          branchId: null,
          name: dto.name,
          email,
          passwordHash: await bcrypt.hash(dto.password, 10),
          role: Role.OWNER,
        }),
      );
    });
    return this.issueTokens(user);
  }

  async login(email: string, password: string) {
    const user = await this.users
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .where('u.email = :email', { email: email.toLowerCase() })
      .getOne();
    if (!user || !user.isActive || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.issueTokens(user);
  }

  async refresh(refreshToken: string) {
    let payload: { sub: string };
    try {
      payload = await this.jwt.verifyAsync(refreshToken, { secret: jwtRefreshSecret() });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const user = await this.users
      .createQueryBuilder('u')
      .addSelect('u.refreshTokenHash')
      .where('u.id = :id', { id: payload.sub })
      .getOne();
    if (!user || !user.isActive || !user.refreshTokenHash || !(await bcrypt.compare(refreshToken, user.refreshTokenHash))) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    return this.issueTokens(user); // rotation: old refresh token stops working
  }

  async logout(userId: string) {
    await this.users.update(userId, { refreshTokenHash: null });
    return { ok: true };
  }

  me(userId: string) {
    return this.users.findOneByOrFail({ id: userId });
  }

  private async issueTokens(user: User) {
    const payload: AuthUser = { sub: user.id, orgId: user.organizationId, branchId: user.branchId, role: user.role };
    const accessToken = await this.jwt.signAsync(payload, { secret: jwtSecret(), expiresIn: 15 * 60 });
    const refreshToken = await this.jwt.signAsync({ sub: user.id }, { secret: jwtRefreshSecret(), expiresIn: 7 * 24 * 3600 });
    await this.users.update(user.id, { refreshTokenHash: await bcrypt.hash(refreshToken, 8) });
    return {
      accessToken,
      refreshToken,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, branchId: user.branchId, organizationId: user.organizationId },
    };
  }
}
