import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { Word } from './word.entity';
import { Example } from './example.entity';

@Entity('definitions')
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

  @Column({ name: 'definition_vi', type: 'text' })
  definitionVi: string;

  @Column({ length: 20, default: 'intermediate' })
  level: string;

  @Column({ name: 'definition_order', type: 'integer', default: 1 })
  definitionOrder: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @OneToMany(() => Example, (example) => example.definition, { cascade: true })
  examples: Example[];
}
