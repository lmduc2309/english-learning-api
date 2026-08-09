import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { DsdSense } from './dsd-sense.entity';
import { DsdPronunciation } from './dsd-pronunciation.entity';
import type { DsdStatus } from './dsd-content-base';

/** An independently selected DSD headword. Carries no legacy identifier. */
@Entity('dsd_entries')
export class DsdEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200 })
  headword: string;

  @Column({ name: 'headword_normalized', type: 'varchar', length: 200 })
  headwordNormalized: string;

  @Column({ type: 'varchar', length: 8, default: 'en' })
  language: string;

  /** DSD-owned learning priority. Never an imported frequency rank. */
  @Column({ name: 'dsd_priority', type: 'int', nullable: true })
  dsdPriority: number | null;

  @Column({ name: 'dsd_band', type: 'varchar', length: 32, nullable: true })
  dsdBand: string | null;

  @Column({ name: 'inventory_evidence_id', type: 'varchar', length: 64 })
  inventoryEvidenceId: string;

  @Column({ type: 'varchar', length: 16, default: 'draft' })
  status: DsdStatus;

  @Column({ type: 'integer', default: 1 })
  revision: number;

  @Column({ name: 'supersedes_id', type: 'uuid', nullable: true })
  supersedesId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => DsdSense, (sense) => sense.entry)
  senses: DsdSense[];

  @OneToMany(() => DsdPronunciation, (p) => p.entry)
  pronunciations: DsdPronunciation[];
}
