import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';

@Entity('word_lists')
@Index(['userId', 'word'], { unique: true })
export class WordList {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ length: 255 })
  word: string;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @Column({ name: 'folder_ids', type: 'uuid', array: true, default: '{}' })
  folderIds: string[];

  @Column({ name: 'review_stage', type: 'smallint', default: 0 })
  reviewStage: number;

  @Column({ name: 'next_review_at', type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  nextReviewAt: Date;

  @Column({ name: 'last_reviewed_at', type: 'timestamptz', nullable: true })
  lastReviewedAt: Date | null;

  @Column({ name: 'review_successes', type: 'integer', default: 0 })
  reviewSuccesses: number;

  @Column({ name: 'review_failures', type: 'integer', default: 0 })
  reviewFailures: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
