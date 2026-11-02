import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { PolishSession } from './polish-session.entity';

// Unique (user_id, lower(text)) is an expression index, created in the migration.
@Entity('polish_phrases')
export class PolishPhrase {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId: string;
  @Column({ name: 'session_id', type: 'uuid', nullable: true }) sessionId: string | null;
  @ManyToOne(() => PolishSession, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'session_id' })
  session?: PolishSession | null;
  @Column({ length: 200 }) text: string;
  @Column({ name: 'source_sentence', type: 'text' }) sourceSentence: string;
  @Column({ name: 'situation_code', length: 40, default: 'other' }) situationCode: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
