import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { Role } from '../common/enums';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) organizationId: string;
  @Column({ type: 'uuid', nullable: true }) branchId: string | null; // null = org-wide
  @Column() name: string;
  @Column({ unique: true }) email: string;
  @Column({ select: false }) passwordHash: string;
  @Column({ type: 'varchar', nullable: true, select: false }) refreshTokenHash: string | null;
  @Column({ type: 'enum', enum: Role }) role: Role;
  @Column({ default: true }) isActive: boolean;
  @CreateDateColumn() createdAt: Date;
}
