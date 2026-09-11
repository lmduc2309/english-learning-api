import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CompetitionPlayer } from './competition-player.entity';

export type CompetitionRoomStatus = 'lobby' | 'playing' | 'finished';

export interface CompetitionQuestion {
  prompt: string;
  answer: string;
  hint: string;
}

@Entity('competition_rooms')
export class CompetitionRoom {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true, length: 6 })
  code: string;

  @Column({ length: 80 })
  name: string;

  @Column({ name: 'host_name', length: 32 })
  hostName: string;

  @Column({ name: 'host_token_hash', length: 64 })
  hostTokenHash: string;

  @Column({ type: 'varchar', length: 16, default: 'lobby' })
  status: CompetitionRoomStatus;

  @Column({ type: 'jsonb' })
  questions: CompetitionQuestion[];

  @Column({ name: 'seconds_per_question', type: 'smallint', default: 20 })
  secondsPerQuestion: number;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'ended_at', type: 'timestamptz', nullable: true })
  endedAt: Date | null;

  @OneToMany(() => CompetitionPlayer, (player) => player.room)
  players: CompetitionPlayer[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
