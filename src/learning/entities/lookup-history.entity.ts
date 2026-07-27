import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('lookup_history')
export class LookupHistory {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index() @Column({ name: 'user_id', type: 'uuid' }) userId: string;
  @Column({ length: 255 }) query: string;
  @Column({ length: 8 }) direction: 'en-vi' | 'vi-en';
  @Column({ name: 'canonical_result', length: 255, nullable: true }) canonicalResult: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
