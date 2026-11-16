import { Body, Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { Repository } from 'typeorm';
import { AuthUser, CurrentUser, JwtAuthGuard, Roles, RolesGuard } from '../common/auth';
import { Role } from '../common/enums';
import { BranchesService } from '../branches/branches.service';
import { BranchMenuItem } from '../entities/branch-menu-item.entity';
import { Category } from '../entities/category.entity';
import { MenuItem } from '../entities/menu-item.entity';

class CategoryDto {
  @IsString() name: string;
  @IsOptional() @IsInt() sortOrder?: number;
}
class MenuItemDto {
  @IsUUID() categoryId: string;
  @IsString() name: string;
  @IsOptional() @IsString() description?: string;
  @IsNumber() @Min(0) basePrice: number;
}
class OverrideDto {
  @IsOptional() @IsNumber() @Min(0) price?: number | null;
  @IsOptional() @IsBoolean() isAvailable?: boolean;
}

@Controller('menu')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MenuController {
  constructor(
    private branches: BranchesService,
    @InjectRepository(Category) private categories: Repository<Category>,
    @InjectRepository(MenuItem) private items: Repository<MenuItem>,
    @InjectRepository(BranchMenuItem) private overrides: Repository<BranchMenuItem>,
  ) {}

  /** Shared org menu. Pass ?branchId= to get effective prices/availability for that branch. */
  @Get()
  async get(@CurrentUser() u: AuthUser, @Query('branchId') branchId?: string) {
    const bId = branchId ?? u.branchId ?? undefined;
    if (bId) await this.branches.getForUser(u, bId);
    const [cats, items] = await Promise.all([
      this.categories.find({ where: { organizationId: u.orgId }, order: { sortOrder: 'ASC', name: 'ASC' } }),
      this.items.find({ where: { organizationId: u.orgId, isActive: true }, order: { name: 'ASC' } }),
    ]);
    const ov = bId ? await this.overrides.find({ where: { branchId: bId } }) : [];
    const byItem = new Map(ov.map((o) => [o.menuItemId, o]));
    return cats.map((c) => ({
      ...c,
      items: items
        .filter((i) => i.categoryId === c.id)
        .map((i) => {
          const o = byItem.get(i.id);
          return { id: i.id, name: i.name, description: i.description, price: o?.price ?? i.basePrice, isAvailable: o?.isAvailable ?? true };
        }),
    }));
  }

  @Post('categories') @Roles(Role.OWNER, Role.ADMIN)
  addCategory(@CurrentUser() u: AuthUser, @Body() dto: CategoryDto) {
    return this.categories.save(this.categories.create({ ...dto, organizationId: u.orgId }));
  }

  @Post('items') @Roles(Role.OWNER, Role.ADMIN)
  async addItem(@CurrentUser() u: AuthUser, @Body() dto: MenuItemDto) {
    if (!(await this.categories.exist({ where: { id: dto.categoryId, organizationId: u.orgId } }))) throw new ForbiddenException('Unknown category');
    return this.items.save(this.items.create({ ...dto, organizationId: u.orgId }));
  }

  /** Set a branch-specific price and/or availability ("86" an item). */
  @Put('branches/:branchId/items/:itemId') @Roles(Role.OWNER, Role.ADMIN)
  async override(
    @CurrentUser() u: AuthUser,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: OverrideDto,
  ) {
    await this.branches.getForUser(u, branchId);
    if (!(await this.items.exist({ where: { id: itemId, organizationId: u.orgId } }))) throw new ForbiddenException('Unknown item');
    const existing = await this.overrides.findOne({ where: { branchId, menuItemId: itemId } });
    return this.overrides.save({ ...(existing ?? { branchId, menuItemId: itemId, isAvailable: true, price: null }), ...dto });
  }
}
