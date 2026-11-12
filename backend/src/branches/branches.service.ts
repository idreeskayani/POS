import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthUser } from '../common/auth';
import { Branch } from '../entities/branch.entity';
import { DiningTable } from '../entities/dining-table.entity';

@Injectable()
export class BranchesService {
  constructor(
    @InjectRepository(Branch) private branches: Repository<Branch>,
    @InjectRepository(DiningTable) private tables: Repository<DiningTable>,
  ) {}

  /** Returns the branch only if the user may access it (same org, and same branch unless org-wide). */
  async getForUser(user: AuthUser, branchId: string): Promise<Branch> {
    if (user.branchId && user.branchId !== branchId) throw new ForbiddenException('No access to this branch');
    const branch = await this.branches.findOne({ where: { id: branchId, organizationId: user.orgId } });
    if (!branch) throw new NotFoundException('Branch not found');
    return branch;
  }

  list(user: AuthUser) {
    return this.branches.find({
      where: user.branchId ? { id: user.branchId, organizationId: user.orgId } : { organizationId: user.orgId },
      order: { name: 'ASC' },
    });
  }

  create(user: AuthUser, dto: { name: string; code: string; address?: string; taxRate?: number; currency?: string }) {
    return this.branches.save(this.branches.create({ ...dto, organizationId: user.orgId }));
  }

  async update(user: AuthUser, branchId: string, dto: { name?: string; address?: string; taxRate?: number; currency?: string }) {
    await this.getForUser(user, branchId);
    await this.branches.update(branchId, dto);
    return this.getForUser(user, branchId);
  }

  async listTables(user: AuthUser, branchId: string) {
    await this.getForUser(user, branchId);
    return this.tables.find({ where: { branchId }, order: { label: 'ASC' } });
  }

  async createTable(user: AuthUser, branchId: string, dto: { label: string; seats?: number }) {
    await this.getForUser(user, branchId);
    return this.tables.save(this.tables.create({ ...dto, branchId }));
  }
}
