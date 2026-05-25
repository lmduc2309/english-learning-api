import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { VerbalMappingSession } from './verbal-mapping-session.entity';

export type Verdict = 'correct' | 'partial' | 'incorrect';

@Entity('verbal_mapping_attempts')
@Unique('uniq_session_sentence', ['sessionId', 'sentenceIndex'])
export class VerbalMappingAttempt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'session_id', type: 'uuid' })
  sessionId: string;

  @ManyToOne(() => VerbalMappingSession, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'session_id' })
  session: VerbalMappingSession;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'sentence_index', type: 'int' })
  sentenceIndex: number;

  @Column({ name: 'vi_sentence', type: 'text' })
  viSentence: string;

  @Column({ name: 'target_words', type: 'jsonb' })
  targetWords: string[];

  @Column({ type: 'text' })
  transcript: string;

  @Column({ type: 'varchar', length: 16 })
  verdict: Verdict;

  @Column({ type: 'int' })
  score: number;

  @Column({ type: 'text' })
  feedback: string;

  @Column({ name: 'suggested_answer', type: 'text' })
  suggestedAnswer: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
