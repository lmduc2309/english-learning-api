import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Word } from './word.entity';

@Entity('pronunciations')
export class Pronunciation {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: number;

  @Column({ name: 'word_id', type: 'bigint' })
  wordId: number;

  @ManyToOne(() => Word, (word) => word.pronunciations, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'word_id' })
  word: Word;

  @Column({ length: 10 })
  accent: string;

  @Column({ type: 'text' })
  ipa: string;

  @Column({ name: 'audio_url', type: 'text', nullable: true })
  audioUrl: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
