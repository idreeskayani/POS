import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Branch } from '../entities/branch.entity';
import { User } from '../entities/user.entity';
import { UsersController } from './users.controller';

@Module({ imports: [TypeOrmModule.forFeature([User, Branch])], controllers: [UsersController] })
export class UsersModule {}
