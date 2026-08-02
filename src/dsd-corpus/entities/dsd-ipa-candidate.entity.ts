import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * A machine-generated IPA suggestion. Working material, never content.
 *
 * This entity is deliberately **not** in DSD_ENTITIES. The API's data source
 * registers that list, so leaving this out means the running application has
 * no repository for the table and cannot query it through TypeORM at all. The
 * `dsd_app` role is also granted nothing on it, so the same is true one layer
 * down. The type exists for the generation and review scripts, which use raw
 * queries.
 *
 * There is no relation to DsdPronunciation. A published pronunciation is
 * authored by a person and reviewed like every other record; it never points
 * at a candidate as its source, which is why no release gate can be satisfied
 * by one.
 */
@Entity('dsd_ipa_candidates')
@Index('IDX_dsd_ipa_candidate_entry', ['entryId'])
export class DsdIpaCandidate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'dsd_entry_id', type: 'uuid' })
  entryId: string;

  @Column({ name: 'accent', type: 'varchar', length: 16 })
  accent: string;

  @Column({ name: 'candidate_ipa', type: 'text' })
  candidateIpa: string;

  /** Digest of the headword the tool was given, so the input is reproducible. */
  @Column({ name: 'input_headword_hash', type: 'char', length: 64 })
  inputHeadwordHash: string;

  @Column({ name: 'tool_id', type: 'varchar', length: 64 })
  toolId: string;

  @Column({ name: 'tool_revision', type: 'varchar', length: 64 })
  toolRevision: string;

  /** Digest of the installed artifact, not just the source revision. */
  @Column({ name: 'artifact_sha256', type: 'char', length: 64 })
  artifactSha256: string;

  @Column({ name: 'configuration', type: 'jsonb' })
  configuration: Record<string, unknown>;

  @Column({ name: 'generated_at', type: 'timestamptz' })
  generatedAt: Date;

  /** No value here means approved or published. There is nothing to promote. */
  @Column({ name: 'status', type: 'varchar', length: 16 })
  status: 'candidate' | 'rejected' | 'superseded';

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
