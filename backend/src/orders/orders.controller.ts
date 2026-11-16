import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsEnum, IsInt, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Max, Min, ValidateNested } from 'class-validator';
import { AuthUser, CurrentUser, JwtAuthGuard, Roles, RolesGuard } from '../common/auth';
import { OrderStatus, OrderType, PaymentMethod, Role } from '../common/enums';
import { OrdersService } from './orders.service';

class OrderLineDto {
  @IsUUID() menuItemId: string;
  @IsInt() @Min(1) @Max(99) quantity: number;
  @IsOptional() @IsString() notes?: string;
}
class CreateOrderDto {
  @IsOptional() @IsUUID() id?: string;
  @IsOptional() @IsUUID() tableId?: string;
  @IsOptional() @IsEnum(OrderType) type?: OrderType;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsNumber() @Min(0) discount?: number;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => OrderLineDto) items: OrderLineDto[];
}
class StatusDto {
  @IsEnum(OrderStatus) status: OrderStatus;
}
class PayDto {
  @IsEnum(PaymentMethod) method: PaymentMethod;
  @IsNumber() @IsPositive() amount: number;
  @IsOptional() @IsString() reference?: string;
}

@Controller('branches/:branchId/orders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrdersController {
  constructor(private svc: OrdersService) {}

  @Post() @Roles(Role.OWNER, Role.ADMIN, Role.CASHIER, Role.WAITER)
  create(@CurrentUser() u: AuthUser, @Param('branchId', ParseUUIDPipe) branchId: string, @Body() dto: CreateOrderDto) {
    return this.svc.create(u, branchId, dto);
  }

  /** ?status=SENT,PREPARING  (comma-separated). Kitchen display uses SENT,PREPARING,READY. */
  @Get()
  list(@CurrentUser() u: AuthUser, @Param('branchId', ParseUUIDPipe) branchId: string, @Query('status') status?: string, @Query('limit') limit?: string) {
    const statuses = status ? (status.split(',').filter((s) => s in OrderStatus) as OrderStatus[]) : undefined;
    return this.svc.list(u, branchId, statuses, limit ? parseInt(limit, 10) : undefined);
  }

  @Get(':id/balance')
  balance(@CurrentUser() u: AuthUser, @Param('branchId', ParseUUIDPipe) branchId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.balance(u, branchId, id);
  }

  @Get(':id')
  get(@CurrentUser() u: AuthUser, @Param('branchId', ParseUUIDPipe) branchId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u, branchId, id);
  }

  @Patch(':id/status')
  setStatus(@CurrentUser() u: AuthUser, @Param('branchId', ParseUUIDPipe) branchId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StatusDto) {
    return this.svc.setStatus(u, branchId, id, dto.status);
  }

  @Post(':id/pay') @Roles(Role.OWNER, Role.ADMIN, Role.CASHIER)
  pay(@CurrentUser() u: AuthUser, @Param('branchId', ParseUUIDPipe) branchId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PayDto) {
    return this.svc.pay(u, branchId, id, dto);
  }
}
