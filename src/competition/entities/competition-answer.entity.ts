import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CompetitionPlayer } from './competition-player.entity';
import { CompetitionRoom } from './competition-room.entity';

@Entity('competition_answers')
@Index(['playerId', 'questionIndex'], { unique: true })
export class CompetitionAnswer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'room_id', type: 'uuid' })
  roomId: string;

  @ManyToOne(() => CompetitionRoom, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'room_id' })
  room: CompetitionRoom;

  @Column({ name: 'player_id', type: 'uuid' })
  playerId: string;

  @ManyToOne(() => CompetitionPlayer, (player) => player.answers, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'player_id' })
  player: CompetitionPlayer;

  @Column({ name: 'question_index', type: 'smallint' })
  questionIndex: number;

  @Column({ type: 'text', default: '' })
  answer: string;

  @Column({ name: 'is_correct', type: 'boolean', nullable: true })
  isCorrect: boolean | null;

  @Column({ name: 'used_hint', type: 'boolean', default: false })
  usedHint: boolean;

  @Column({ type: 'integer', default: 0 })
  points: number;

  @Column({ name: 'response_ms', type: 'integer', nullable: true })
  responseMs: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
