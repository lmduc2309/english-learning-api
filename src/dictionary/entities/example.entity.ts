import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Definition } from './definition.entity';

@Entity('examples')
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

  @Column({ name: 'example_vi', type: 'text' })
  exampleVi: string;

  @Column({ length: 255, nullable: true })
  source: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
