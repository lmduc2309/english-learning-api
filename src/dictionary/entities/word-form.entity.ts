import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Word } from './word.entity';

@Entity('word_forms')
export class WordForm {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: number;

  @Column({ name: 'word_id', type: 'bigint' })
  wordId: number;

  @ManyToOne(() => Word, (word) => word.wordForms, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'word_id' })
  word: Word;

  @Column({ name: 'form_type', length: 50 })
  formType: string;

  @Column({ name: 'form_word', length: 255 })
  formWord: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
