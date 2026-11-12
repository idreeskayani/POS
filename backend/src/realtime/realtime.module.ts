import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Branch } from '../entities/branch.entity';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  imports: [JwtModule.register({}), TypeOrmModule.forFeature([Branch])],
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
