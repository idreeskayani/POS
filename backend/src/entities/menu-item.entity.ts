import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { numeric } from '../common/numeric';

@Entity('menu_items')
export class MenuItem {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) organizationId: string;
  @Column({ type: 'uuid' }) categoryId: string;
  @Column() name: string;
  @Column({ type: 'varchar', nullable: true }) description: string | null;
  @Column({ type: 'numeric', precision: 10, scale: 2, transformer: numeric }) basePrice: number;
  @Column({ default: true }) isActive: boolean;
}
