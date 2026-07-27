import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';

export type Difficulty = 'beginner' | 'intermediate' | 'advanced';
export interface SessionSentence {
  index: number;
  vi: string;
  words: string[];
}

@Entity('verbal_mapping_sessions')
export class VerbalMappingSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'word_list_id', type: 'uuid', nullable: true })
  wordListId: string | null;

  @Column({ name: 'source_words', type: 'jsonb' })
  sourceWords: string[];

  @Column({ name: 'num_sentences', type: 'int' })
  numSentences: number;

  @Column({ type: 'varchar', length: 16 })
  difficulty: Difficulty;

  @Column({ type: 'jsonb' })
  sentences: SessionSentence[];

  @CreateDateColumn({ name: 'started_at', type: 'timestamptz' })
  startedAt: Date;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @Column({ name: 'total_score', type: 'numeric', precision: 5, scale: 2, nullable: true })
  totalScore: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
