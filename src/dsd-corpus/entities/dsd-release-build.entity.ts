import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * A release package that was built, signed and verified.
 *
 * Distinct from a release audit, which says a corpus *could* be released. This
 * says a specific set of bytes *was* produced from it. Conflating the two is how
 * a customer ends up with a package nobody can tie back to a decision.
 *
 * Immutable by trigger: a package cannot be re-signed or re-attributed after the
 * fact. Building again uses a new release id; one public identifier can never
 * be made to refer to two different manifests.
 */
@Entity('dsd_release_builds')
@Index('IDX_dsd_release_build_release', ['releaseId'])
export class DsdReleaseBuild {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'release_id', type: 'varchar', length: 64 })
  releaseId: string;

  @Column({ name: 'channel', type: 'varchar', length: 16 })
  channel: 'internal' | 'public';

  @Column({ name: 'public_eligible', type: 'boolean' })
  publicEligible: boolean;

  // ── what was built ────────────────────────────────────────────────────────

  @Column({ name: 'manifest_sha256', type: 'char', length: 64 })
  manifestSha256: string;

  /** Exact canonical bytes that were hashed and signed, stored as UTF-8 text. */
  @Column({ name: 'manifest_bytes', type: 'text' })
  manifestBytes: string;

  /** Detached Ed25519 signature over the canonical manifest bytes, base64. */
  @Column({ name: 'signature', type: 'text' })
  signature: string;

  @Column({ name: 'signer_key_id', type: 'varchar', length: 64 })
  signerKeyId: string;

  @Column({ name: 'signature_algorithm', type: 'varchar', length: 32 })
  signatureAlgorithm: string;

  // ── what it was built from ────────────────────────────────────────────────

  @Column({ name: 'source_database', type: 'varchar', length: 64 })
  sourceDatabase: string;

  @Column({ name: 'source_migration', type: 'varchar', length: 32 })
  sourceMigration: string;

  /** Without this a build cannot be reproduced byte for byte. */
  @Column({ name: 'source_date_epoch', type: 'bigint' })
  sourceDateEpoch: string;

  @Column({ name: 'similarity_policy_sha256', type: 'char', length: 64 })
  similarityPolicySha256: string;

  @Column({ name: 'source_registry_sha256', type: 'char', length: 64 })
  sourceRegistrySha256: string;

  @Column({ name: 'tool_registry_sha256', type: 'char', length: 64 })
  toolRegistrySha256: string;

  @Column({ name: 'contributor_registry_sha256', type: 'char', length: 64 })
  contributorRegistrySha256: string;

  // ── what the audit concluded ──────────────────────────────────────────────

  @Column({ name: 'audit_version', type: 'varchar', length: 64 })
  auditVersion: string;

  @Column({ name: 'entry_count', type: 'integer' })
  entryCount: number;

  @Column({ name: 'sense_count', type: 'integer' })
  senseCount: number;

  @Column({ name: 'translation_count', type: 'integer' })
  translationCount: number;

  @Column({ name: 'example_count', type: 'integer' })
  exampleCount: number;

  @Column({ name: 'pronunciation_count', type: 'integer' })
  pronunciationCount: number;

  /** Unique authored relation rows; the export may project symmetric rows twice. */
  @Column({ name: 'relation_count', type: 'integer' })
  relationCount: number;

  @Column({ name: 'audio_asset_count', type: 'integer' })
  audioAssetCount: number;

  @Column({ name: 'territories', type: 'text', array: true })
  territories: string[];

  @Column({ name: 'built_at', type: 'timestamptz' })
  builtAt: Date;

  @Column({ name: 'built_by', type: 'varchar', length: 64 })
  builtBy: string;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
