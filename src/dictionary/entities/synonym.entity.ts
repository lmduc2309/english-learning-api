import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Word } from './word.entity';

@Entity('synonyms')
export class Synonym {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: number;

  @Column({ name: 'word_id', type: 'bigint' })
  wordId: number;

  @ManyToOne(() => Word, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'word_id' })
  word: Word;

  @Column({ name: 'synonym_word', length: 255 })
  synonymWord: string;

  @Column({ name: 'similarity_score', type: 'decimal', precision: 3, scale: 2, nullable: true })
  similarityScore: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
