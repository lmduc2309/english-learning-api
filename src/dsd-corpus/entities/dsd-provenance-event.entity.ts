import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type DsdEventKind =
  | 'entry' | 'sense' | 'translation' | 'example' | 'pronunciation' | 'batch' | 'release';

export type DsdEventType =
  | 'authored' | 'submitted' | 'reviewed' | 'approved' | 'rejected' | 'published'
  | 'retired' | 'superseded' | 'imported' | 'generated' | 'similarity_checked' | 'released';

/**
 * Append-only authorship and review ledger.
 *
 * A database trigger rejects UPDATE and DELETE outside an owner-only
 * break-glass path. There is deliberately no updatedAt: a row that can be
 * amended is not a ledger entry.
 */
@Entity('dsd_provenance_events')
@Index('IDX_dsd_event_entity', ['entityKind', 'entityId'])
@Index('IDX_dsd_event_occurred', ['occurredAt'])
export class DsdProvenanceEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'entity_kind', type: 'varchar', length: 32 })
  entityKind: DsdEventKind;

  @Column({ name: 'entity_id', type: 'uuid' })
  entityId: string;

  @Column({ name: 'event_type', type: 'varchar', length: 32 })
  eventType: DsdEventType;

  /** Pseudonymous contributor ID, or a tool ID for machine events. */
  @Column({ type: 'varchar', length: 64 })
  actor: string;

  @Column({ name: 'source_id', type: 'varchar', length: 64, nullable: true })
  sourceId: string | null;

  @Column({ name: 'tool_id', type: 'varchar', length: 64, nullable: true })
  toolId: string | null;

  @Column({ name: 'input_hash', type: 'char', length: 64, nullable: true })
  inputHash: string | null;

  @Column({ name: 'output_hash', type: 'char', length: 64, nullable: true })
  outputHash: string | null;

  @Column({ name: 'evidence_id', type: 'varchar', length: 64, nullable: true })
  evidenceId: string | null;

  @Column({ name: 'occurred_at', type: 'timestamptz', default: () => 'now()' })
  occurredAt: Date;
}
