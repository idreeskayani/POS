import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { AuthUser, CurrentUser, JwtAuthGuard, Roles, RolesGuard } from '../common/auth';
import { Role } from '../common/enums';
import { BranchesService } from './branches.service';

class CreateBranchDto {
  @IsString() name: string;
  @IsString() code: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(100) taxRate?: number;
  @IsOptional() @IsString() currency?: string;
}
class UpdateBranchDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(100) taxRate?: number;
  @IsOptional() @IsString() currency?: string;
}
class CreateTableDto {
  @IsString() label: string;
  @IsOptional() @IsInt() @Min(1) seats?: number;
}

@Controller('branches')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BranchesController {
  constructor(private svc: BranchesService) {}

  @Get() list(@CurrentUser() u: AuthUser) {
    return this.svc.list(u);
  }

  @Post() @Roles(Role.OWNER, Role.ADMIN)
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateBranchDto) {
    return this.svc.create(u, dto);
  }

  @Patch(':branchId') @Roles(Role.OWNER, Role.ADMIN)
  update(@CurrentUser() u: AuthUser, @Param('branchId', ParseUUIDPipe) id: string, @Body() dto: UpdateBranchDto) {
    return this.svc.update(u, id, dto);
  }

  @Get(':branchId/tables')
  tables(@CurrentUser() u: AuthUser, @Param('branchId', ParseUUIDPipe) id: string) {
    return this.svc.listTables(u, id);
  }

  @Post(':branchId/tables') @Roles(Role.OWNER, Role.ADMIN)
  addTable(@CurrentUser() u: AuthUser, @Param('branchId', ParseUUIDPipe) id: string, @Body() dto: CreateTableDto) {
    return this.svc.createTable(u, id, dto);
  }
}
