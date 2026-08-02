import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { DsdContentBase } from './dsd-content-base';
import { DsdSense } from './dsd-sense.entity';

/** A DSD-authored bilingual example demonstrating one sense in use. */
@Entity('dsd_examples')
@Index('UQ_dsd_example_sense_order', ['senseId', 'exampleOrder'], { unique: true })
export class DsdExample extends DsdContentBase {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'dsd_sense_id', type: 'uuid' })
  senseId: string;

  @ManyToOne(() => DsdSense, (sense) => sense.examples, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'dsd_sense_id' })
  sense: DsdSense;

  @Column({ name: 'example_order', type: 'smallint' })
  exampleOrder: number;

  @Column({ name: 'example_en', type: 'text' })
  exampleEn: string;

  @Column({ name: 'example_vi', type: 'text' })
  exampleVi: string;
}
