import { Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export type DsdStatus =
  | 'draft'
  | 'in_review'
  | 'approved'
  | 'published'
  | 'retired'
  | 'rejected';

/**
 * Authorship, review and provenance columns shared by every publishable DSD
 * record.
 *
 * The database enforces what matters — independent review, published
 * immutability, source identity — so these are the transport shape, not the
 * guarantee. See 1785628800000-CreateDsdCorpusCore.ts.
 */
export abstract class DsdContentBase {
  /** Immutable. A correction supersedes rather than edits. */
  @Column({ type: 'int', default: 1 })
  revision: number;

  /** Same-table link to the retired revision this one replaces. */
  @Column({ name: 'supersedes_id', type: 'uuid', nullable: true })
  supersedesId: string | null;

  /** Pseudonymous contributor ID. Never a name. */
  @Column({ name: 'authored_by', type: 'varchar', length: 64 })
  authoredBy: string;

  @Column({ name: 'authored_at', type: 'timestamptz', default: () => 'now()' })
  authoredAt: Date;

  /** Must differ from authoredBy before approval; enforced by CHECK. */
  @Column({ name: 'reviewed_by', type: 'varchar', length: 64, nullable: true })
  reviewedBy: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  @Column({ name: 'content_sha256', type: 'char', length: 64 })
  contentSha256: string;

  /** Validated against the versioned registry by the release audit. */
  @Column({ name: 'source_id', type: 'varchar', length: 64 })
  sourceId: string;

  @Column({ name: 'batch_id', type: 'varchar', length: 64 })
  batchId: string;

  @Column({ name: 'rights_evidence_id', type: 'varchar', length: 64 })
  rightsEvidenceId: string;

  @Column({ type: 'varchar', length: 16, default: 'draft' })
  status: DsdStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
