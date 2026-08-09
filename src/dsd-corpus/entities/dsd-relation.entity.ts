import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { DsdSense } from './dsd-sense.entity';

/**
 * A DSD-authored relation between two senses.
 *
 * Sense level rather than entry level, because "bank" the riverside and "bank"
 * the institution do not share synonyms. Both ends are foreign keys to
 * `dsd_senses`, so a relation cannot reference a legacy word — there is no
 * column here that could hold a legacy integer id.
 *
 * Stored in one direction only. `dsd_serving_relations` exposes symmetric types
 * both ways, so a synonym cannot exist as half a pair, while directional types
 * like `derived_form` are served only as stated.
 *
 * There is deliberately no CEFR or frequency field. `dsd_band` on the entry is a
 * product ordering value, and a database CHECK refuses a band spelled like a
 * CEFR level — labelling content A2 without a documented rubric is a claim DSD
 * cannot support.
 */
@Entity('dsd_relations')
@Index('IDX_dsd_relation_from', ['fromSenseId', 'relationType'])
export class DsdRelation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'from_sense_id', type: 'uuid' })
  fromSenseId: string;

  @ManyToOne(() => DsdSense, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'from_sense_id' })
  fromSense: DsdSense;

  @Column({ name: 'to_sense_id', type: 'uuid' })
  toSenseId: string;

  @ManyToOne(() => DsdSense, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'to_sense_id' })
  toSense: DsdSense;

  @Column({ name: 'relation_type', type: 'varchar', length: 24 })
  relationType: 'synonym' | 'antonym' | 'related' | 'derived_form' | 'see_also';

  @Column({ name: 'status', type: 'varchar', length: 16 })
  status: 'draft' | 'in_review' | 'approved' | 'published' | 'retired' | 'rejected';

  @Column({ type: 'integer', default: 1 })
  revision: number;

  @Column({ name: 'supersedes_id', type: 'uuid', nullable: true })
  supersedesId: string | null;

  @Column({ name: 'content_sha256', type: 'char', length: 64 })
  contentSha256: string;

  @Column({ name: 'authored_by', type: 'varchar', length: 64 })
  authoredBy: string;

  /** Never equal to authoredBy; a CHECK enforces that. */
  @Column({ name: 'reviewed_by', type: 'varchar', length: 64, nullable: true })
  reviewedBy: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  @Column({ name: 'source_id', type: 'varchar', length: 64 })
  sourceId: string;

  @Column({ name: 'batch_id', type: 'varchar', length: 64 })
  batchId: string;

  @Column({ name: 'rights_evidence_id', type: 'varchar', length: 64 })
  rightsEvidenceId: string;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
