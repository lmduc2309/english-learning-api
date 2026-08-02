import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * One compliance measurement of one piece of DSD text.
 *
 * It records that a comparison happened and how close it came, never what it
 * was compared against. `legacyDigest` proves a match without keeping the
 * matched wording, and there is no column for a legacy row identifier.
 *
 * The row is bound to `contentSha256` and `policySha256` together. Editing the
 * text or changing the policy leaves no result matching the current pair, and
 * the publication gate reads that absence as "not audited" — which is how a
 * stale verdict stops being a verdict.
 */
@Entity('dsd_similarity_results')
@Index('IDX_dsd_similarity_entity', ['entityKind', 'entityId'])
export class DsdSimilarityResult {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'entity_kind', type: 'varchar', length: 16 })
  entityKind: 'sense' | 'example';

  @Column({ name: 'entity_id', type: 'uuid' })
  entityId: string;

  @Column({ name: 'record_type', type: 'varchar', length: 16 })
  recordType: 'definition' | 'example';

  @Column({ name: 'content_sha256', type: 'char', length: 64 })
  contentSha256: string;

  @Column({ name: 'normalization_version', type: 'integer' })
  normalizationVersion: number;

  @Column({ name: 'algorithm_version', type: 'integer' })
  algorithmVersion: number;

  @Column({ name: 'policy_version', type: 'varchar', length: 32 })
  policyVersion: string;

  @Column({ name: 'policy_sha256', type: 'char', length: 64 })
  policySha256: string;

  @Column({ name: 'component_scores', type: 'jsonb' })
  componentScores: Record<string, number | boolean>;

  @Column({ name: 'match_class', type: 'varchar', length: 16 })
  matchClass: 'exact' | 'high' | 'medium' | 'low';

  /** sha256 of the normalized legacy text. Never the text itself. */
  @Column({ name: 'legacy_digest', type: 'char', length: 64, nullable: true })
  legacyDigest: string | null;

  @Column({ name: 'decision', type: 'varchar', length: 32 })
  decision: 'clear' | 'manual_review' | 'rewrite_required' | 'independently_authored_cleared';

  @Column({ name: 'decision_reason', type: 'varchar', length: 64, nullable: true })
  decisionReason: string | null;

  /** Points at the compliance record. The rationale lives there, not here. */
  @Column({ name: 'decision_evidence_id', type: 'varchar', length: 64, nullable: true })
  decisionEvidenceId: string | null;

  @Column({ name: 'decided_by', type: 'varchar', length: 64, nullable: true })
  decidedBy: string | null;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt: Date | null;

  @Column({ name: 'audited_by', type: 'varchar', length: 64 })
  auditedBy: string;

  @Column({ name: 'audited_at', type: 'timestamptz' })
  auditedAt: Date;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
