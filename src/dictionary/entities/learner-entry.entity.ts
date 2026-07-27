import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Word } from './word.entity';
import { LearnerPronunciation } from './learner-pronunciation.entity';
import { LearnerSense } from './learner-sense.entity';

@Entity('learner_entries')
@Index('IDX_learner_entry_publication', ['status', 'learnerRank'])
@Index('IDX_learner_entry_band', ['learnerBand', 'learnerRank'])
@Check('CHK_learner_entry_rank', '"learner_rank" IS NULL OR "learner_rank" > 0')
@Check(
  'CHK_learner_entry_rank_provenance',
  '"learner_rank" IS NULL OR ("rank_source" IS NOT NULL AND length(btrim("rank_source")) > 0 AND "rank_source_version" IS NOT NULL AND length(btrim("rank_source_version")) > 0 AND "rank_source_license" IS NOT NULL AND length(btrim("rank_source_license")) > 0)',
)
@Check('CHK_learner_entry_status', '"status" IN (\'draft\', \'published\', \'retired\')')
@Check('CHK_learner_entry_band', '"learner_band" IS NULL OR length(btrim("learner_band")) > 0')
export class LearnerEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'word_id', type: 'bigint' })
  wordId: number;

  @OneToOne(() => Word, (word) => word.learnerEntry, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'word_id',
    foreignKeyConstraintName: 'FK_learner_entry_word',
  })
  word: Word;

  @Column({ name: 'learner_rank', type: 'integer', nullable: true })
  learnerRank: number;

  @Column({ name: 'learner_band', length: 24, nullable: true })
  learnerBand: string;

  @Column({ name: 'rank_source', length: 80, nullable: true })
  rankSource: string;

  @Column({ name: 'rank_source_version', length: 40, nullable: true })
  rankSourceVersion: string;

  @Column({ name: 'rank_source_url', type: 'text', nullable: true })
  rankSourceUrl: string;

  @Column({ name: 'rank_source_license', length: 80, nullable: true })
  rankSourceLicense: string;

  @Column({ length: 24, default: 'draft' })
  status: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => LearnerSense, (sense) => sense.entry)
  senses: LearnerSense[];

  @OneToMany(() => LearnerPronunciation, (pronunciation) => pronunciation.entry)
  pronunciations: LearnerPronunciation[];
}
