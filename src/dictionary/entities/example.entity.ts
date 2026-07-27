import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Check,
} from 'typeorm';
import { Definition } from './definition.entity';

@Entity('examples')
@Check('CHK_examples_reference_only', '"is_learner_visible" = false')
export class Example {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: number;

  @Column({ name: 'definition_id', type: 'bigint' })
  definitionId: number;

  @ManyToOne(() => Definition, (definition) => definition.examples, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'definition_id' })
  definition: Definition;

  @Column({ name: 'example_en', type: 'text' })
  exampleEn: string;

  @Column({ name: 'example_vi', type: 'text', nullable: true })
  exampleVi: string;

  @Column({ length: 255, nullable: true })
  source: string;

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
      'Trust gate: legacy examples are reference-only; reviewed learner content lives in learner_examples',
  })
  isLearnerVisible: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
