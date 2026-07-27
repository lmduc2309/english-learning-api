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
import { LearnerSense } from './learner-sense.entity';

@Entity('learner_sense_translations')
@Unique('UQ_learner_translation_sense_locale', ['learnerSenseId', 'locale'])
@Index('IDX_learner_translation_approved', ['learnerSenseId', 'locale'], {
  where: '"review_status" = \'approved\'',
})
@Check('CHK_learner_translation_locale', 'length(btrim("locale")) > 0')
@Check('CHK_learner_translation_text', 'length(btrim("text")) > 0')
@Check('CHK_learner_translation_text_normalized', 'length(btrim("text_normalized")) > 0')
@Check('CHK_learner_translation_method', 'length(btrim("method")) > 0')
@Check('CHK_learner_translation_source', 'length(btrim("source")) > 0')
@Check('CHK_learner_translation_license', 'length(btrim("source_license")) > 0')
@Check('CHK_learner_translation_confidence', '"confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1)')
@Check('CHK_learner_translation_status', '"review_status" IN (\'draft\', \'in_review\', \'approved\', \'rejected\')')
@Check('CHK_learner_translation_approved_review', '"review_status" <> \'approved\' OR ("reviewed_by" IS NOT NULL AND length(btrim("reviewed_by")) > 0 AND "reviewed_at" IS NOT NULL)')
export class LearnerSenseTranslation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'learner_sense_id', type: 'uuid' })
  learnerSenseId: string;

  @ManyToOne(() => LearnerSense, (sense) => sense.translations, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'learner_sense_id',
    foreignKeyConstraintName: 'FK_learner_translation_sense',
  })
  sense: LearnerSense;

  @Column({ length: 10, default: 'vi' })
  locale: string;

  @Column({ type: 'text' })
  text: string;

  @Column({ name: 'text_normalized', type: 'text' })
  textNormalized: string;

  @Column({ length: 40 })
  method: string;

  @Column({ length: 80 })
  source: string;

  @Column({ name: 'source_url', type: 'text', nullable: true })
  sourceUrl: string;

  @Column({ name: 'source_license', length: 80 })
  sourceLicense: string;

  @Column({ type: 'real', nullable: true })
  confidence: number;

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
