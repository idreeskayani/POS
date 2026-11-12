import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BranchesModule } from '../branches/branches.module';
import { BranchMenuItem } from '../entities/branch-menu-item.entity';
import { DiningTable } from '../entities/dining-table.entity';
import { MenuItem } from '../entities/menu-item.entity';
import { Order } from '../entities/order.entity';
import { Payment } from '../entities/payment.entity';
import { RealtimeModule } from '../realtime/realtime.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [BranchesModule, RealtimeModule, TypeOrmModule.forFeature([Order, MenuItem, BranchMenuItem, DiningTable, Payment])],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
