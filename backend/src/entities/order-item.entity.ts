import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Relation } from 'typeorm';
import { numeric } from '../common/numeric';
import { Order } from './order.entity';

@Entity('order_items')
export class OrderItem {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) orderId: string;
  @ManyToOne(() => Order, (o) => o.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'orderId' })
  order: Relation<Order>;
  @Column({ type: 'uuid' }) menuItemId: string;
  @Column() name: string; // snapshot at time of order
  @Column({ type: 'numeric', precision: 10, scale: 2, transformer: numeric }) unitPrice: number;
  @Column({ type: 'int' }) quantity: number;
  @Column({ type: 'numeric', precision: 12, scale: 2, transformer: numeric }) lineTotal: number;
  @Column({ type: 'varchar', nullable: true }) notes: string | null;
}
