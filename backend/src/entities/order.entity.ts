import { Column, CreateDateColumn, Entity, Index, OneToMany, PrimaryColumn, Relation, Unique, UpdateDateColumn } from 'typeorm';
import { OrderStatus, OrderType } from '../common/enums';
import { numeric } from '../common/numeric';
import { OrderItem } from './order-item.entity';

@Entity('orders')
@Index(['branchId', 'createdAt'])
@Unique(['branchId', 'orderNumber'])
export class Order {
  @PrimaryColumn('uuid') id: string; // may be client-generated (offline sync / idempotency)
  @Column({ type: 'uuid' }) branchId: string;
  @Column() orderNumber: string; // e.g. BR1-0042
  @Column({ type: 'uuid', nullable: true }) tableId: string | null;
  @Column({ type: 'enum', enum: OrderType, default: OrderType.DINE_IN }) type: OrderType;
  @Column({ type: 'enum', enum: OrderStatus, default: OrderStatus.SENT }) status: OrderStatus;
  @Column({ type: 'numeric', precision: 12, scale: 2, transformer: numeric }) subtotal: number;
  @Column({ type: 'numeric', precision: 12, scale: 2, transformer: numeric }) tax: number;
  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0, transformer: numeric }) discount: number;
  @Column({ type: 'numeric', precision: 12, scale: 2, transformer: numeric }) total: number;
  @Column({ type: 'varchar', nullable: true }) notes: string | null;
  @Column({ type: 'uuid' }) createdById: string;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
  @OneToMany(() => OrderItem, (i) => i.order, { cascade: true }) items: Relation<OrderItem[]>;
}
