import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { DsdContentBase } from './dsd-content-base';
import { DsdEntry } from './dsd-entry.entity';

/**
 * Human-approved IPA. Machine candidates never land here — they live in
 * dsd_ipa_candidates and cannot be presented as pronunciation content.
 */
@Entity('dsd_pronunciations')
@Index('UQ_dsd_pronunciation_entry_accent_priority', ['entryId', 'accent', 'priority'], { unique: true })
export class DsdPronunciation extends DsdContentBase {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'dsd_entry_id', type: 'uuid' })
  entryId: string;

  @ManyToOne(() => DsdEntry, (entry) => entry.pronunciations, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'dsd_entry_id' })
  entry: DsdEntry;

  @Column({ type: 'varchar', length: 16 })
  accent: string;

  @Column({ type: 'text' })
  ipa: string;

  @Column({ type: 'smallint', default: 1 })
  priority: number;
}
