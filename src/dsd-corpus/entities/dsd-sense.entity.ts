import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { DsdContentBase } from './dsd-content-base';
import { DsdEntry } from './dsd-entry.entity';
import { DsdTranslation } from './dsd-translation.entity';
import { DsdExample } from './dsd-example.entity';

/** A DSD-authored English definition. Authored from a blank template. */
@Entity('dsd_senses')
@Index('UQ_dsd_sense_entry_key', ['entryId', 'senseKey'], { unique: true })
@Index('UQ_dsd_sense_entry_order', ['entryId', 'senseOrder'], { unique: true })
export class DsdSense extends DsdContentBase {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'dsd_entry_id', type: 'uuid' })
  entryId: string;

  @ManyToOne(() => DsdEntry, (entry) => entry.senses, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'dsd_entry_id' })
  entry: DsdEntry;

  @Column({ name: 'sense_key', type: 'varchar', length: 64 })
  senseKey: string;

  @Column({ name: 'sense_order', type: 'smallint' })
  senseOrder: number;

  @Column({ name: 'part_of_speech', type: 'varchar', length: 32 })
  partOfSpeech: string;

  @Column({ name: 'definition_en', type: 'text' })
  definitionEn: string;

  @Column({ name: 'usage_labels', type: 'text', array: true, default: () => "'{}'" })
  usageLabels: string[];

  @OneToMany(() => DsdTranslation, (t) => t.sense)
  translations: DsdTranslation[];

  @OneToMany(() => DsdExample, (e) => e.sense)
  examples: DsdExample[];
}
