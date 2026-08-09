import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { DsdContentBase } from './dsd-content-base';
import { DsdSense } from './dsd-sense.entity';

/** A reviewed Vietnamese translation of one sense. */
@Entity('dsd_translations')
export class DsdTranslation extends DsdContentBase {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'dsd_sense_id', type: 'uuid' })
  senseId: string;

  @ManyToOne(() => DsdSense, (sense) => sense.translations, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'dsd_sense_id' })
  sense: DsdSense;

  @Column({ type: 'varchar', length: 8 })
  locale: string;

  @Column({ type: 'text' })
  text: string;

  /** Diacritic-folded form for search. Tone marks stay significant in `text`. */
  @Column({ name: 'text_normalized', type: 'text' })
  textNormalized: string;
}
