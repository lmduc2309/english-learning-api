import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Check,
} from 'typeorm';
import { Word } from './word.entity';
import { Example } from './example.entity';

@Entity('definitions')
@Check('CHK_definitions_reference_only', '"is_learner_visible" = false')
export class Definition {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: number;

  @Column({ name: 'word_id', type: 'bigint' })
  wordId: number;

  @ManyToOne(() => Word, (word) => word.definitions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'word_id' })
  word: Word;

  @Column({ name: 'part_of_speech', length: 50 })
  partOfSpeech: string;

  @Column({ name: 'definition_en', type: 'text' })
  definitionEn: string;

  @Column({ name: 'definition_vi', type: 'text', nullable: true })
  definitionVi: string;

  @Column({ length: 20, default: 'intermediate' })
  level: string;

  @Column({ name: 'definition_order', type: 'integer', default: 1 })
  definitionOrder: number;

  @Column({ length: 40, nullable: true })
  source: string;

  @Column({ name: 'source_sense_id', length: 255, nullable: true })
  sourceSenseId: string;

  @Column({ name: 'translation_method', length: 40, nullable: true })
  translationMethod: string;

  @Column({ name: 'translation_confidence', type: 'real', nullable: true })
  translationConfidence: number;

  @Column({ name: 'review_status', length: 24, default: 'raw' })
  reviewStatus: string;

  @Column({ name: 'quality_flags', type: 'text', array: true, default: '{}' })
  qualityFlags: string[];

  @Column({
    name: 'is_learner_visible',
    default: false,
    comment:
      'Trust gate: legacy definitions are reference-only; reviewed learner content lives in learner_senses',
  })
  isLearnerVisible: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @OneToMany(() => Example, (example) => example.definition, { cascade: true })
  examples: Example[];
}
