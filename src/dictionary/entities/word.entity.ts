import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { Definition } from './definition.entity';
import { Pronunciation } from './pronunciation.entity';
import { WordForm } from './word-form.entity';

@Entity('words')
export class Word {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: number;

  @Column({ unique: true, length: 255 })
  word: string;

  @Column({ length: 10, default: 'en' })
  language: string;

  @Column({ name: 'word_normalized', length: 255 })
  wordNormalized: string;

  @Column({ name: 'frequency_rank', type: 'integer', nullable: true })
  frequencyRank: number;

  @Column({ name: 'part_of_speech', type: 'text', array: true, nullable: true })
  partOfSpeech: string[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => Definition, (definition) => definition.word, {
    cascade: true,
  })
  definitions: Definition[];

  @OneToMany(() => Pronunciation, (pronunciation) => pronunciation.word, {
    cascade: true,
  })
  pronunciations: Pronunciation[];

  @OneToMany(() => WordForm, (wordForm) => wordForm.word, { cascade: true })
  wordForms: WordForm[];
}
