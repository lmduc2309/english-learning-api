import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('polish_sessions')
@Index(['userId', 'createdAt'])
export class PolishSession {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId: string;
  @Column({ name: 'source_app', length: 80 }) sourceApp: string;
  @Column({ length: 10 }) tone: string;
  @Column({ name: 'raw_text', type: 'text' }) rawText: string;
  @Column({ name: 'edited_text', type: 'text' }) editedText: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
