import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { numeric } from '../common/numeric';

@Entity('branches')
@Unique(['organizationId', 'code'])
export class Branch {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) organizationId: string;
  @Column() name: string;
  @Column() code: string; // short code used in order numbers, e.g. "BR1"
  @Column({ type: 'varchar', nullable: true }) address: string | null;
  @Column({ type: 'numeric', precision: 5, scale: 2, default: 0, transformer: numeric }) taxRate: number; // percent
  @Column({ default: 'PKR' }) currency: string;
  @Column({ type: 'int', default: 0 }) orderSeq: number; // per-branch order counter
  @Column({ default: true }) isActive: boolean;
  @CreateDateColumn() createdAt: Date;
}
