import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BranchesModule } from '../branches/branches.module';
import { BranchMenuItem } from '../entities/branch-menu-item.entity';
import { Category } from '../entities/category.entity';
import { MenuItem } from '../entities/menu-item.entity';
import { MenuController } from './menu.controller';

@Module({
  imports: [BranchesModule, TypeOrmModule.forFeature([Category, MenuItem, BranchMenuItem])],
  controllers: [MenuController],
})
export class MenuModule {}
