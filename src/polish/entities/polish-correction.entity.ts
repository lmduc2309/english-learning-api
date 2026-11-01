import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { PolishSession } from './polish-session.entity';

@Entity('polish_corrections')
export class PolishCorrectionEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'session_id', type: 'uuid' }) sessionId: string;
  @ManyToOne(() => PolishSession, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'session_id' })
  session: PolishSession;
  @Column({ length: 10 }) kind: string;
  @Index()
  @Column({ name: 'pattern_code', length: 40 }) patternCode: string;
  @Column({ name: 'wrong_text', type: 'text' }) wrongText: string;
  @Column({ name: 'right_text', type: 'text' }) rightText: string;
  @Column({ name: 'explanation_vi', type: 'text' }) explanationVi: string;
  @Column({ type: 'boolean', default: false }) minor: boolean;
}
