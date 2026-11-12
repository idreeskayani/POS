import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { BranchesModule } from './branches/branches.module';
import { MenuModule } from './menu/menu.module';
import { OrdersModule } from './orders/orders.module';
import { RealtimeModule } from './realtime/realtime.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://pos:pos@localhost:5432/pos',
      autoLoadEntities: false,
      entities: [__dirname + '/entities/*.entity{.ts,.js}'],
      // Dev convenience. Switch to migrations before going to production.
      synchronize: process.env.NODE_ENV !== 'production',
    }),
    AuthModule,
    BranchesModule,
    UsersModule,
    MenuModule,
    OrdersModule,
    RealtimeModule,
  ],
})
export class AppModule {}
