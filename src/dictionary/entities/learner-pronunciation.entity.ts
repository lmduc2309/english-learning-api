import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { LearnerEntry } from './learner-entry.entity';

@Entity('learner_pronunciations')
@Unique('UQ_learner_pronunciation_entry_accent_priority', [
  'learnerEntryId',
  'accent',
  'priority',
])
@Index('IDX_learner_pronunciation_approved', ['learnerEntryId', 'accent', 'priority'], {
  where: '"review_status" = \'approved\'',
})
@Check('CHK_learner_pronunciation_accent', 'length(btrim("accent")) > 0')
@Check('CHK_learner_pronunciation_ipa', 'length(btrim("ipa")) > 0')
@Check('CHK_learner_pronunciation_priority', '"priority" > 0')
@Check('CHK_learner_pronunciation_source', 'length(btrim("source")) > 0')
@Check('CHK_learner_pronunciation_license', 'length(btrim("source_license")) > 0')
@Check('CHK_learner_pronunciation_status', '"review_status" IN (\'draft\', \'in_review\', \'approved\', \'rejected\')')
@Check('CHK_learner_pronunciation_approved_review', '"review_status" <> \'approved\' OR ("reviewed_by" IS NOT NULL AND length(btrim("reviewed_by")) > 0 AND "reviewed_at" IS NOT NULL)')
export class LearnerPronunciation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'learner_entry_id', type: 'uuid' })
  learnerEntryId: string;

  @ManyToOne(() => LearnerEntry, (entry) => entry.pronunciations, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'learner_entry_id',
    foreignKeyConstraintName: 'FK_learner_pronunciation_entry',
  })
  entry: LearnerEntry;

  @Column({ length: 20 })
  accent: string;

  @Column({ type: 'text' })
  ipa: string;

  @Column({ type: 'smallint', default: 1 })
  priority: number;

  @Column({ length: 80 })
  source: string;

  @Column({ name: 'source_url', type: 'text', nullable: true })
  sourceUrl: string;

  @Column({ name: 'source_license', length: 80 })
  sourceLicense: string;

  @Column({ name: 'review_status', length: 24, default: 'draft' })
  reviewStatus: string;

  @Column({ name: 'reviewed_by', length: 255, nullable: true })
  reviewedBy: string;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
