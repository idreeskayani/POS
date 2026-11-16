import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BranchesModule } from '../branches/branches.module';
import { Order } from '../entities/order.entity';
import { Payment } from '../entities/payment.entity';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [BranchesModule, TypeOrmModule.forFeature([Order, Payment])],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
