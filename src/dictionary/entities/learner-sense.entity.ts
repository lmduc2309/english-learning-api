import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Definition } from './definition.entity';
import { LearnerEntry } from './learner-entry.entity';
import { LearnerExample } from './learner-example.entity';
import { LearnerSenseTranslation } from './learner-sense-translation.entity';

@Entity('learner_senses')
@Unique('UQ_learner_sense_entry_key', ['learnerEntryId', 'senseKey'])
@Unique('UQ_learner_sense_entry_order', ['learnerEntryId', 'senseOrder'])
@Index('IDX_learner_sense_publication', ['learnerEntryId', 'status', 'senseOrder'])
@Index('IDX_learner_sense_cefr', ['cefrLevel', 'senseOrder'], {
  where: '"status" = \'published\'',
})
@Check('CHK_learner_sense_key', 'length(btrim("sense_key")) > 0')
@Check('CHK_learner_sense_order', '"sense_order" > 0')
@Check('CHK_learner_sense_pos', 'length(btrim("part_of_speech")) > 0')
@Check('CHK_learner_sense_definition', 'length(btrim("definition_en")) > 0')
@Check('CHK_learner_sense_cefr', '"cefr_level" IS NULL OR "cefr_level" IN (\'A1\', \'A2\', \'B1\', \'B2\', \'C1\', \'C2\')')
@Check('CHK_learner_sense_cefr_source', '"cefr_level" IS NULL OR ("cefr_source" IS NOT NULL AND length(btrim("cefr_source")) > 0)')
@Check(
  'CHK_learner_sense_cefr_provenance',
  '"cefr_level" IS NULL OR ("cefr_source_url" IS NOT NULL AND length(btrim("cefr_source_url")) > 0 AND "cefr_source_version" IS NOT NULL AND length(btrim("cefr_source_version")) > 0 AND "cefr_source_license" IS NOT NULL AND length(btrim("cefr_source_license")) > 0 AND "cefr_basis" IS NOT NULL AND length(btrim("cefr_basis")) > 0)',
)
@Check('CHK_learner_sense_cefr_confidence', '"cefr_confidence" IS NULL OR ("cefr_confidence" >= 0 AND "cefr_confidence" <= 1)')
@Check('CHK_learner_sense_status', '"status" IN (\'draft\', \'published\', \'retired\')')
@Check('CHK_learner_sense_source', 'length(btrim("definition_source")) > 0')
@Check('CHK_learner_sense_license', 'length(btrim("definition_source_license")) > 0')
@Check(
  'CHK_learner_sense_definition_provenance',
  '("definition_source_version" IS NULL AND "definition_source_artifact_sha256" IS NULL) OR ("definition_source_version" IS NOT NULL AND length(btrim("definition_source_version")) > 0 AND "definition_source_artifact_sha256" IS NOT NULL AND "definition_source_artifact_sha256" ~ \'^[0-9a-f]{64}$\')',
)
@Check(
  'CHK_learner_sense_published_definition_provenance',
  '"status" <> \'published\' OR ("definition_source_version" IS NOT NULL AND length(btrim("definition_source_version")) > 0 AND "definition_source_artifact_sha256" IS NOT NULL AND "definition_source_artifact_sha256" ~ \'^[0-9a-f]{64}$\')',
)
@Check('CHK_learner_sense_published_review', '"status" <> \'published\' OR ("reviewed_by" IS NOT NULL AND length(btrim("reviewed_by")) > 0 AND "reviewed_at" IS NOT NULL)')
export class LearnerSense {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'learner_entry_id', type: 'uuid' })
  learnerEntryId: string;

  @ManyToOne(() => LearnerEntry, (entry) => entry.senses, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'learner_entry_id',
    foreignKeyConstraintName: 'FK_learner_sense_entry',
  })
  entry: LearnerEntry;

  @Column({ name: 'source_definition_id', type: 'bigint', nullable: true })
  sourceDefinitionId: number;

  @ManyToOne(() => Definition, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'source_definition_id',
    foreignKeyConstraintName: 'FK_learner_sense_source_definition',
  })
  sourceDefinition: Definition;

  @Column({ name: 'sense_key', length: 255 })
  senseKey: string;

  @Column({ name: 'sense_order', type: 'smallint' })
  senseOrder: number;

  @Column({ name: 'part_of_speech', length: 50 })
  partOfSpeech: string;

  @Column({ name: 'definition_en', type: 'text' })
  definitionEn: string;

  @Column({ name: 'cefr_level', length: 2, nullable: true })
  cefrLevel: string;

  @Column({ name: 'cefr_source', length: 80, nullable: true })
  cefrSource: string;

  @Column({ name: 'cefr_source_url', type: 'text', nullable: true })
  cefrSourceUrl: string;

  @Column({ name: 'cefr_source_version', length: 40, nullable: true })
  cefrSourceVersion: string;

  @Column({ name: 'cefr_source_license', length: 80, nullable: true })
  cefrSourceLicense: string;

  @Column({ name: 'cefr_basis', length: 40, nullable: true })
  cefrBasis: string;

  @Column({ name: 'cefr_confidence', type: 'real', nullable: true })
  cefrConfidence: number;

  @Column({ name: 'usage_labels', type: 'text', array: true, default: '{}' })
  usageLabels: string[];

  @Column({ length: 24, default: 'draft' })
  status: string;

  @Column({ name: 'definition_source', length: 80 })
  definitionSource: string;

  @Column({ name: 'definition_source_url', type: 'text', nullable: true })
  definitionSourceUrl: string;

  @Column({ name: 'definition_source_license', length: 80 })
  definitionSourceLicense: string;

  @Column({ name: 'definition_source_version', length: 40, nullable: true })
  definitionSourceVersion: string;

  @Column({
    name: 'definition_source_artifact_sha256',
    length: 64,
    nullable: true,
  })
  definitionSourceArtifactSha256: string;

  @Column({ name: 'review_notes', type: 'text', nullable: true })
  reviewNotes: string;

  @Column({ name: 'reviewed_by', length: 255, nullable: true })
  reviewedBy: string;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => LearnerExample, (example) => example.sense)
  examples: LearnerExample[];

  @OneToMany(() => LearnerSenseTranslation, (translation) => translation.sense)
  translations: LearnerSenseTranslation[];
}
