import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { PaymentMethod } from '../common/enums';
import { numeric } from '../common/numeric';

@Entity('payments')
export class Payment {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) orderId: string;
  @Column({ type: 'uuid' }) branchId: string;
  @Column({ type: 'enum', enum: PaymentMethod }) method: PaymentMethod;
  @Column({ type: 'numeric', precision: 12, scale: 2, transformer: numeric }) amount: number;
  @Column({ type: 'varchar', nullable: true }) reference: string | null;
  @Column({ type: 'uuid' }) receivedById: string;
  @CreateDateColumn() createdAt: Date;
}
