import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { TableStatus } from '../common/enums';

@Entity('dining_tables')
@Unique(['branchId', 'label'])
export class DiningTable {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) branchId: string;
  @Column() label: string;
  @Column({ type: 'int', default: 4 }) seats: number;
  @Column({ type: 'enum', enum: TableStatus, default: TableStatus.FREE }) status: TableStatus;
}
