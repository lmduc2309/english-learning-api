import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CompetitionAnswer } from './competition-answer.entity';
import { CompetitionRoom } from './competition-room.entity';

@Entity('competition_players')
@Index(['roomId', 'name'], { unique: true })
export class CompetitionPlayer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'room_id', type: 'uuid' })
  roomId: string;

  @ManyToOne(() => CompetitionRoom, (room) => room.players, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'room_id' })
  room: CompetitionRoom;

  @Column({ length: 32 })
  name: string;

  @Column({ name: 'token_hash', length: 64 })
  tokenHash: string;

  @Column({ type: 'integer', default: 0 })
  score: number;

  @Column({ name: 'last_seen_at', type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  lastSeenAt: Date;

  @OneToMany(() => CompetitionAnswer, (answer) => answer.player)
  answers: CompetitionAnswer[];

  @CreateDateColumn({ name: 'joined_at', type: 'timestamptz' })
  joinedAt: Date;
}
