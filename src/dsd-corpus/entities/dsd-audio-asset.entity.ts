import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { DsdEntry } from './dsd-entry.entity';

/**
 * One generated pronunciation recording and the provenance behind it.
 *
 * `logicalAssetKey` is the identity of the *generation* — canonical input text,
 * voice, runtime, model and encoder configuration — while `audioSha256` is the
 * identity of the *bytes*. Keeping them apart is what makes a non-deterministic
 * encoder detectable: the same logical key yielding a second hash is a conflict
 * to investigate, not a file to overwrite.
 *
 * The serving role cannot read this table. It reads `dsd_servable_audio`, a view
 * restricted to accepted assets with approved voice rights and no QA findings,
 * so no API query can reach an unreviewed recording.
 */
@Entity('dsd_audio_assets')
@Index('IDX_dsd_audio_entry', ['entryId'])
@Index('IDX_dsd_audio_status', ['reviewStatus'])
export class DsdAudioAsset {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'dsd_entry_id', type: 'uuid' })
  entryId: string;

  @ManyToOne(() => DsdEntry, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'dsd_entry_id' })
  entry: DsdEntry;

  // ── what was spoken ───────────────────────────────────────────────────────

  @Column({ name: 'input_kind', type: 'varchar', length: 16 })
  inputKind: 'pronunciation' | 'headword';

  @Column({ name: 'input_record_id', type: 'uuid' })
  inputRecordId: string;

  @Column({ name: 'input_text_sha256', type: 'char', length: 64 })
  inputTextSha256: string;

  /** Identity of the generation, independent of the bytes it produced. */
  @Column({ name: 'logical_asset_key', type: 'char', length: 64 })
  logicalAssetKey: string;

  // ── which voice, and what it was ──────────────────────────────────────────

  /** The opaque id a client uses. Never the model name. */
  @Column({ name: 'public_voice_id', type: 'varchar', length: 32 })
  publicVoiceId: string;

  @Column({ name: 'engine_voice', type: 'varchar', length: 64 })
  engineVoice: string;

  @Column({ name: 'engine_version', type: 'varchar', length: 64 })
  engineVersion: string;

  @Column({ name: 'model_revision', type: 'varchar', length: 64 })
  modelRevision: string;

  @Column({ name: 'model_sha256', type: 'char', length: 64 })
  modelSha256: string;

  @Column({ name: 'model_license', type: 'varchar', length: 64 })
  modelLicense: string;

  @Column({ name: 'training_dataset', type: 'varchar', length: 128 })
  trainingDataset: string;

  /** Must be 'approved' before an asset can be accepted. */
  @Column({ name: 'training_dataset_status', type: 'varchar', length: 16 })
  trainingDatasetStatus: 'approved' | 'pending' | 'blocked';

  // ── the bytes ─────────────────────────────────────────────────────────────

  /** Content-addressed: dsd/audio/<voice>/<audio-sha256>.<format>. */
  @Column({ name: 'storage_key', type: 'text' })
  storageKey: string;

  @Column({ name: 'audio_sha256', type: 'char', length: 64 })
  audioSha256: string;

  @Column({ name: 'media_type', type: 'varchar', length: 32 })
  mediaType: 'audio/wav' | 'audio/mpeg';

  @Column({ name: 'format', type: 'varchar', length: 8 })
  format: 'wav' | 'mp3';

  @Column({ name: 'duration_ms', type: 'integer' })
  durationMs: number;

  @Column({ name: 'sample_rate', type: 'integer' })
  sampleRate: number;

  @Column({ name: 'channels', type: 'smallint' })
  channels: number;

  @Column({ name: 'byte_size', type: 'integer' })
  byteSize: number;

  // ── who made it, and who listened ─────────────────────────────────────────

  @Column({ name: 'generated_at', type: 'timestamptz' })
  generatedAt: Date;

  @Column({ name: 'generator_actor', type: 'varchar', length: 64 })
  generatorActor: string;

  /** The release container that produced it, or null for a test candidate. */
  @Column({ name: 'release_runtime_digest', type: 'varchar', length: 80, nullable: true })
  releaseRuntimeDigest: string | null;

  /** Evidence that this specific voice/model is cleared for target use. */
  @Column({ name: 'voice_rights_evidence_id', type: 'varchar', length: 64, nullable: true })
  voiceRightsEvidenceId: string | null;

  @Column({ name: 'review_status', type: 'varchar', length: 24 })
  reviewStatus:
    | 'pending_qa'
    | 'qa_failed'
    | 'awaiting_review'
    | 'accepted'
    | 'rejected'
    | 'quarantined';

  @Column({ name: 'qa_findings', type: 'jsonb' })
  qaFindings: Array<{ rule: string; detail: string }>;

  /** Set only by a human listening decision; a trigger enforces that. */
  @Column({ name: 'reviewed_by', type: 'varchar', length: 64, nullable: true })
  reviewedBy: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  @Column({ name: 'review_notes', type: 'text', nullable: true })
  reviewNotes: string | null;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
