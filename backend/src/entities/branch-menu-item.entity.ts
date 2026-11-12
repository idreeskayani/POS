import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { numeric } from '../common/numeric';

/** Per-branch override of a shared menu item (price and availability). */
@Entity('branch_menu_items')
@Unique(['branchId', 'menuItemId'])
export class BranchMenuItem {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) branchId: string;
  @Column({ type: 'uuid' }) menuItemId: string;
  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true, transformer: numeric }) price: number | null;
  @Column({ default: true }) isAvailable: boolean;
}
