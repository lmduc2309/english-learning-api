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
import { Example } from './example.entity';
import { LearnerSense } from './learner-sense.entity';

@Entity('learner_examples')
@Unique('UQ_learner_example_sense_order', ['learnerSenseId', 'exampleOrder'])
@Index('IDX_learner_example_approved', ['learnerSenseId', 'exampleOrder'], {
  where: '"review_status" = \'approved\'',
})
@Check('CHK_learner_example_order', '"example_order" > 0')
@Check('CHK_learner_example_en', 'length(btrim("example_en")) > 0')
@Check('CHK_learner_example_vi', 'length(btrim("example_vi")) > 0')
@Check('CHK_learner_example_source', 'length(btrim("source")) > 0')
@Check('CHK_learner_example_license', 'length(btrim("source_license")) > 0')
@Check('CHK_learner_example_status', '"review_status" IN (\'draft\', \'in_review\', \'approved\', \'rejected\')')
@Check('CHK_learner_example_approved_review', '"review_status" <> \'approved\' OR ("reviewed_by" IS NOT NULL AND length(btrim("reviewed_by")) > 0 AND "reviewed_at" IS NOT NULL)')
export class LearnerExample {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'learner_sense_id', type: 'uuid' })
  learnerSenseId: string;

  @ManyToOne(() => LearnerSense, (sense) => sense.examples, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'learner_sense_id',
    foreignKeyConstraintName: 'FK_learner_example_sense',
  })
  sense: LearnerSense;

  @Column({ name: 'example_order', type: 'smallint' })
  exampleOrder: number;

  @Column({ name: 'source_example_id', type: 'bigint', nullable: true })
  sourceExampleId: number;

  @ManyToOne(() => Example, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'source_example_id',
    foreignKeyConstraintName: 'FK_learner_example_source',
  })
  sourceExample: Example;

  @Column({ name: 'example_en', type: 'text' })
  exampleEn: string;

  @Column({ name: 'example_vi', type: 'text' })
  exampleVi: string;

  @Column({ name: 'review_status', length: 24, default: 'draft' })
  reviewStatus: string;

  @Column({ length: 80 })
  source: string;

  @Column({ name: 'source_url', type: 'text', nullable: true })
  sourceUrl: string;

  @Column({ name: 'source_license', length: 80 })
  sourceLicense: string;

  @Column({ name: 'reviewed_by', length: 255, nullable: true })
  reviewedBy: string;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
