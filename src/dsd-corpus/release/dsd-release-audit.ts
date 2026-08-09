/**
 * The DSD release audit.
 *
 * This is the last gate before a corpus becomes something a customer pays for,
 * so it is built to be boring and total: a pure function over a snapshot of
 * facts, producing GO or NO-GO and a specific reason for every refusal.
 *
 * Three properties matter more than the individual checks.
 *
 * **It is pure.** Gathering the facts is the CLI's job; deciding is this
 * function's. That means every blocker below can be reproduced from a fixture,
 * including the ones you cannot easily create on demand — a stale backup proof,
 * a revoked signer key, a superseded similarity policy.
 *
 * **It fails closed.** Absent evidence is a blocker, never a pass. A missing
 * listening decision, a missing off-host backup copy and a missing territory
 * approval all read the same way: nobody has shown this is releasable.
 *
 * **A GO is a record, not a boolean.** The result carries the database
 * snapshot, every registry and policy digest, the backup proof, the evidence
 * IDs, the territories, the signer key and this implementation's own version.
 * A GO nobody can reconstruct six months later is not evidence of anything.
 */

/** Bumped whenever a blocker is added, removed, or changes meaning. */
export const AUDIT_VERSION = 'dsd-release-audit/2.2.0';

/** Voices whose evidence must never appear in a serving asset. */
export const BLOCKED_VOICE_EVIDENCE = [
  'en_US-amy-medium',
  'en_US-ryan-medium',
  'en_US-lessac-medium',
  'amy',
  'ryan',
  'lessac',
];

export const REQUIRED_VOICES = ['en_US-ljspeech-medium', 'en_US-norman-medium'];
export const REQUIRED_VOICE_BINDINGS: Record<string, string> = {
  'en_US-ljspeech-medium': 'en-aria',
  'en_US-norman-medium': 'en-guy',
};

/** Field names that betray a legacy reference wherever they appear. */
export const LEGACY_REFERENCE_FIELDS = [
  'word_id', 'wordId', 'definition_id', 'definitionId', 'legacy_id', 'legacyId',
  'oewn_sense_id', 'synonym_id', 'learner_entry_id',
];

export type BlockerCode =
  | 'no_published_entries'
  | 'release_entry_count_mismatch'
  | 'unapproved_source'
  | 'unapproved_tool'
  | 'legacy_reference'
  | 'missing_authorship'
  | 'content_hash_mismatch'
  | 'same_author_and_reviewer'
  | 'missing_translation'
  | 'missing_example'
  | 'missing_ipa'
  | 'missing_voice_audio'
  | 'audio_missing_qa_proof'
  | 'audio_missing_listening_decision'
  | 'audio_missing_object_hash'
  | 'audio_missing_voice_rights'
  | 'audio_unpinned_runtime'
  | 'audio_self_review'
  | 'audio_stale_input'
  | 'audio_unresolved_quarantine'
  | 'audio_object_missing_or_corrupt'
  | 'blocked_voice_evidence'
  | 'similarity_exact'
  | 'similarity_unresolved'
  | 'similarity_stale'
  | 'similarity_policy_superseded'
  | 'critical_quality_finding'
  | 'mutable_tool_artifact'
  | 'candidate_exposed_as_content'
  | 'missing_contributor_rights_evidence'
  | 'missing_clean_room_declaration'
  | 'missing_rights_matrix_approval'
  | 'missing_territory_approval'
  | 'missing_legal_signoff'
  | 'backup_proof_missing'
  | 'backup_proof_stale'
  | 'backup_proof_future'
  | 'backup_proof_no_off_host_copy'
  | 'backup_proof_incomplete'
  | 'backup_proof_migration_mismatch'
  | 'release_channel_policy_violation'
  | 'signer_key_unknown'
  | 'signer_key_revoked';

export interface Blocker {
  code: BlockerCode;
  detail: string;
}

// ─── the facts the audit needs ──────────────────────────────────────────────

export interface ReleaseSense {
  senseId: string;
  definitionEn: string;
  authoredBy: string | null;
  reviewedBy: string | null;
  contentSha256: string | null;
  contentHashMatches: boolean;
  sourceId: string;
  rightsEvidenceId: string;
  /** Provenance events recorded for this sense. Zero means no trail. */
  provenanceEventCount: number;
  approvedVietnameseCount: number;
  approvedExampleCount: number;
  /** Extra keys seen on the row. Used to catch a legacy reference. */
  fields?: string[];
}

export interface ReleasePronunciation {
  pronunciationId: string;
  accent: string;
  ipa: string;
  authoredBy: string | null;
  reviewedBy: string | null;
  contentSha256: string | null;
  contentHashMatches: boolean;
  sourceId: string;
  rightsEvidenceId: string;
  provenanceEventCount: number;
  /** True when the final record is a machine candidate rather than authored. */
  isGeneratedCandidate?: boolean;
}

export interface ReleaseAuthoredRecord {
  recordId: string;
  kind: 'translation' | 'example' | 'relation';
  authoredBy: string | null;
  reviewedBy: string | null;
  contentSha256: string | null;
  contentHashMatches: boolean;
  sourceId: string;
  rightsEvidenceId: string;
  provenanceEventCount: number;
}

export interface ReleaseEntry {
  entryId: string;
  headword: string;
  senses: ReleaseSense[];
  pronunciations: ReleasePronunciation[];
}

export interface ReleaseAudioAsset {
  assetId: string;
  entryId: string;
  inputKind: 'pronunciation' | 'headword';
  inputRecordId: string;
  engineVoice: string;
  publicVoiceId: string;
  /** Empty means automated QA left no findings, which is what is required. */
  qaFindings: string[];
  /** True only when QA actually ran. Absent proof is a blocker. */
  qaProof: boolean;
  reviewedBy: string | null;
  generatorActor: string;
  releaseRuntimeDigest: string | null;
  voiceRightsEvidenceId: string | null;
  inputTextSha256: string;
  expectedInputTextSha256: string;
  audioSha256: string | null;
  /** The hash of the bytes actually in the object store, if it was checked. */
  objectSha256: string | null;
  trainingDatasetStatus: string;
  reviewStatus: string;
}

export interface ReleaseSimilarityResult {
  entityId: string;
  matchClass: 'exact' | 'high' | 'medium' | 'low';
  decision: string;
  /** The content the result was measured against. */
  contentSha256: string;
  /** The policy the result was measured under. */
  policySha256: string;
}

export interface ReleaseBackupProof {
  proofId: string;
  verifiedAt: string;
  offHostCopy: boolean;
  /** The migration version the restored database was at. */
  migrationVersion: string;
  databases: Array<{
    database: string;
    manifestSha256: string;
    dumpSha256: string;
    remoteVersionIds: string[];
  }>;
}

export interface ReleaseGovernance {
  cleanRoomDeclarationId: string;
  rightsMatrixApprovalId: string;
  legalSignOffId: string;
  targetTerritories: string[];
  approvedTerritories: string[];
}

export interface ReleaseToolArtifact {
  toolId: string;
  revision: string;
  artifactSha256: string | null;
  /** True when the artifact could change without the digest changing. */
  mutable: boolean;
}

export interface ReleaseAuditInput {
  releaseId: string;
  channel: 'internal' | 'public';
  /** Result of assessReleaseId, injected so the audit does not re-derive policy. */
  releaseIdIsPublicEligible: boolean;
  /** Count from the database snapshot, kept separate from fixture detail. */
  publishedEntryCount: number;
  now: string;
  snapshot: { database: string; migrationVersion: string; takenAt: string };
  registryDigests: { source: string; tool: string; contributor: string };
  similarityPolicy: { version: string; sha256: string; approvers: string[] } | null;
  entries: ReleaseEntry[];
  authoredRecords: ReleaseAuthoredRecord[];
  audioAssets: ReleaseAudioAsset[];
  similarityResults: ReleaseSimilarityResult[];
  qualityFindings: Array<{ severity: string; rule: string; entityId: string }>;
  toolArtifacts: ReleaseToolArtifact[];
  approvedScopesBySource: Record<string, string[]>;
  approvedToolIds: string[];
  approvedVoiceEvidenceByEngine: Record<string, string[]>;
  contributorRightsEvidence: Record<string, string>;
  governance: ReleaseGovernance;
  backupProof: ReleaseBackupProof | null;
  restoreMaxAgeHours: number;
  signer: { keyId: string; registryStatus: 'active' | 'revoked' | null };
}

export interface GoRecord {
  releaseId: string;
  channel: string;
  auditVersion: string;
  databaseSnapshot: { database: string; migrationVersion: string; takenAt: string };
  registryDigests: { source: string; tool: string; contributor: string };
  similarityPolicy: { version: string; sha256: string };
  backupProofId: string;
  cleanRoomDeclarationId: string;
  rightsMatrixApprovalId: string;
  legalSignOffId: string;
  territories: string[];
  signerKeyId: string;
  entryCount: number;
  senseCount: number;
  audioAssetCount: number;
  auditedAt: string;
}

export interface ReleaseAuditResult {
  verdict: 'GO' | 'NO-GO';
  releaseId: string;
  channel: string;
  auditVersion: string;
  blockers: Blocker[];
  /** Present only on GO. A verdict nobody can reconstruct proves nothing. */
  record: GoRecord | null;
}

// ─── the audit ──────────────────────────────────────────────────────────────

export function auditRelease(input: ReleaseAuditInput): ReleaseAuditResult {
  const blockers: Blocker[] = [];
  const block = (code: BlockerCode, detail: string) => blockers.push({ code, detail });

  // ── 1. there is something to release ──────────────────────────────────────
  if (input.publishedEntryCount === 0 || input.entries.length === 0) {
    block('no_published_entries', 'the release contains no published entries');
  }
  const declaredCount = /DSD-REL-V\d+-(\d+)-/.exec(input.releaseId)?.[1];
  if (declaredCount && Number(declaredCount) !== input.publishedEntryCount) {
    block(
      'release_entry_count_mismatch',
      `release id declares ${declaredCount} entries but the snapshot contains ` +
        `${input.publishedEntryCount}`,
    );
  }

  // ── 2. release identity and channel ───────────────────────────────────────
  if (input.channel === 'public' && !input.releaseIdIsPublicEligible) {
    // The pilot cannot be promoted here either. The scale is part of the id.
    block(
      'release_channel_policy_violation',
      `release '${input.releaseId}' is not public-eligible and cannot be released to the ` +
        'public channel',
    );
  }

  // ── 3. signer ─────────────────────────────────────────────────────────────
  if (!input.signer.keyId.trim() || input.signer.registryStatus === null) {
    block(
      'signer_key_unknown',
      `signer key '${input.signer.keyId}' has no entry in the public-key registry`,
    );
  } else if (input.signer.registryStatus === 'revoked') {
    block('signer_key_revoked', `signer key '${input.signer.keyId}' is revoked`);
  }

  // ── 4. governance evidence ────────────────────────────────────────────────
  if (!input.governance.cleanRoomDeclarationId.trim()) {
    block('missing_clean_room_declaration', 'no clean-room declaration is recorded');
  }
  if (!input.governance.rightsMatrixApprovalId.trim()) {
    block('missing_rights_matrix_approval', 'the rights matrix has no recorded approval');
  }
  if (!input.governance.legalSignOffId.trim()) {
    block('missing_legal_signoff', 'no legal sign-off is recorded');
  }
  const unapprovedTerritories = input.governance.targetTerritories.filter(
    (territory) => !input.governance.approvedTerritories.includes(territory),
  );
  if (input.governance.targetTerritories.length === 0) {
    block('missing_territory_approval', 'no release territories are declared');
  } else if (unapprovedTerritories.length > 0) {
    block(
      'missing_territory_approval',
      `territories not approved: ${unapprovedTerritories.join(', ')}`,
    );
  }

  // ── 5. backup and restore proof ───────────────────────────────────────────
  if (!input.backupProof) {
    block('backup_proof_missing', 'no verified backup/restore proof is recorded');
  } else {
    const ageHours =
      (Date.parse(input.now) - Date.parse(input.backupProof.verifiedAt)) / 3_600_000;
    if (!Number.isFinite(ageHours)) {
      block('backup_proof_missing', 'the backup proof has no parseable verification time');
    } else if (ageHours < 0) {
      block('backup_proof_future', 'the backup proof verification time is in the future');
    } else if (!Number.isFinite(input.restoreMaxAgeHours) || input.restoreMaxAgeHours <= 0) {
      block('backup_proof_stale', 'the restore proof age limit is invalid');
    } else if (ageHours > input.restoreMaxAgeHours) {
      block(
        'backup_proof_stale',
        `the latest verified restore is ${Math.round(ageHours)}h old, older than the ` +
          `${input.restoreMaxAgeHours}h limit`,
      );
    }
    if (!input.backupProof.offHostCopy) {
      // A backup on the same host is not a disaster-recovery path.
      block('backup_proof_no_off_host_copy', `proof ${input.backupProof.proofId} has no off-host copy`);
    }
    const covered = input.backupProof.databases ?? [];
    if (
      covered.length !== 2
      || new Set(covered.map((database) => database.database)).size !== 2
      || !covered.some((database) => database.database === input.snapshot.database)
      || covered.some(
        (database) =>
          !/^[0-9a-f]{64}$/.test(database.manifestSha256)
          || !/^[0-9a-f]{64}$/.test(database.dumpSha256)
          || database.remoteVersionIds.length !== 2
          || database.remoteVersionIds.some((version) => !version.trim()),
      )
    ) {
      block(
        'backup_proof_incomplete',
        `proof ${input.backupProof.proofId} does not bind two complete remote database backups`,
      );
    }
    if (input.backupProof.migrationVersion !== input.snapshot.migrationVersion) {
      block(
        'backup_proof_migration_mismatch',
        `the proof covers migration ${input.backupProof.migrationVersion} but the release ` +
          `database is at ${input.snapshot.migrationVersion}`,
      );
    }
  }

  // ── 6. similarity policy ──────────────────────────────────────────────────
  if (!input.similarityPolicy) {
    block('similarity_policy_superseded', 'no approved similarity policy is recorded');
  } else if (input.similarityPolicy.approvers.length < 3) {
    block(
      'similarity_policy_superseded',
      `the similarity policy has ${input.similarityPolicy.approvers.length} approver(s); three are required`,
    );
  }

  // ── 7. quality ────────────────────────────────────────────────────────────
  for (const finding of input.qualityFindings) {
    if (finding.severity === 'critical') {
      block(
        'critical_quality_finding',
        `${finding.entityId}: ${finding.rule}`,
      );
    }
  }

  // ── 8. tools ──────────────────────────────────────────────────────────────
  for (const artifact of input.toolArtifacts) {
    if (!input.approvedToolIds.includes(artifact.toolId)) {
      block('unapproved_tool', `tool '${artifact.toolId}' is not approved`);
    }
    if (!artifact.artifactSha256 || artifact.mutable) {
      // An artifact that can change without its digest changing makes every
      // claim about what produced the content unverifiable.
      block(
        'mutable_tool_artifact',
        `tool '${artifact.toolId}' at ${artifact.revision} has ` +
          (artifact.artifactSha256 ? 'a mutable artifact' : 'no artifact digest'),
      );
    }
  }

  // ── 9. content ────────────────────────────────────────────────────────────
  const senseById = new Map<string, ReleaseSense>();

  for (const entry of input.entries) {
    if (entry.senses.length === 0) {
      block('no_published_entries', `${entry.headword}: no published sense`);
    }

    for (const sense of entry.senses) {
      senseById.set(sense.senseId, sense);
      const where = `${entry.headword} sense ${sense.senseId.slice(0, 8)}`;

      if (!sense.authoredBy || !sense.reviewedBy || !sense.contentSha256) {
        block(
          'missing_authorship',
          `${where} is missing ${[
            !sense.authoredBy && 'an author',
            !sense.reviewedBy && 'a reviewer',
            !sense.contentSha256 && 'a content hash',
          ]
            .filter(Boolean)
            .join(', ')}`,
        );
      }
      if (!sense.contentHashMatches) {
        block('content_hash_mismatch', `${where} content does not match its recorded hash`);
      }
      if (sense.provenanceEventCount === 0) {
        block('missing_authorship', `${where} has no provenance event`);
      }
      if (sense.authoredBy && sense.authoredBy === sense.reviewedBy) {
        block('same_author_and_reviewer', `${where} was reviewed by its own author`);
      }
      if (sense.authoredBy && !input.contributorRightsEvidence[sense.authoredBy]) {
        block(
          'missing_contributor_rights_evidence',
          `${where}: no rights evidence on file for ${sense.authoredBy}`,
        );
      }
      if (
        sense.authoredBy
        && input.contributorRightsEvidence[sense.authoredBy] !== sense.rightsEvidenceId
      ) {
        block(
          'missing_contributor_rights_evidence',
          `${where}: row rights evidence does not match ${sense.authoredBy}'s active assignment`,
        );
      }
      if (sense.reviewedBy && !input.contributorRightsEvidence[sense.reviewedBy]) {
        block(
          'missing_contributor_rights_evidence',
          `${where}: no rights evidence on file for reviewer ${sense.reviewedBy}`,
        );
      }

      const scopes = input.approvedScopesBySource[sense.sourceId];
      if (!scopes || !scopes.includes('definition')) {
        block(
          'unapproved_source',
          `${where}: source '${sense.sourceId}' is not approved for definitions`,
        );
      }

      if (sense.approvedVietnameseCount === 0) {
        block('missing_translation', `${where} has no approved Vietnamese`);
      }
      if (sense.approvedExampleCount === 0) {
        block('missing_example', `${where} has no approved bilingual example`);
      }

      for (const field of sense.fields ?? []) {
        if (LEGACY_REFERENCE_FIELDS.includes(field)) {
          block('legacy_reference', `${where} carries the legacy field '${field}'`);
        }
      }
    }

    const enUs = entry.pronunciations.filter((p) => p.accent === 'en-US' && p.ipa.trim());
    if (enUs.length === 0) {
      block('missing_ipa', `${entry.headword} has no approved en-US IPA`);
    }
    for (const pronunciation of enUs) {
      if (pronunciation.isGeneratedCandidate) {
        // A machine candidate is working material. Serving one as the final
        // record would make the whole two-person IPA review decorative.
        block(
          'candidate_exposed_as_content',
          `${entry.headword}: a generated IPA candidate is the final pronunciation record`,
        );
      }
      if (!pronunciation.authoredBy || !pronunciation.reviewedBy) {
        block('missing_authorship', `${entry.headword} IPA is missing an author or reviewer`);
      } else if (pronunciation.authoredBy === pronunciation.reviewedBy) {
        block('same_author_and_reviewer', `${entry.headword} IPA was reviewed by its own author`);
      }
      if (!pronunciation.contentSha256 || !pronunciation.contentHashMatches) {
        block('content_hash_mismatch', `${entry.headword} IPA does not match its recorded hash`);
      }
      if (pronunciation.provenanceEventCount === 0) {
        block('missing_authorship', `${entry.headword} IPA has no matching provenance event`);
      }
      if (!input.approvedScopesBySource[pronunciation.sourceId]?.includes('pronunciation')) {
        block(
          'unapproved_source',
          `${entry.headword} IPA source '${pronunciation.sourceId}' is not approved for pronunciation`,
        );
      }
      if (
        !pronunciation.authoredBy
        || input.contributorRightsEvidence[pronunciation.authoredBy]
          !== pronunciation.rightsEvidenceId
      ) {
        block(
          'missing_contributor_rights_evidence',
          `${entry.headword} IPA has no matching author rights evidence`,
        );
      }
      if (pronunciation.reviewedBy && !input.contributorRightsEvidence[pronunciation.reviewedBy]) {
        block(
          'missing_contributor_rights_evidence',
          `${entry.headword} IPA reviewer has no rights evidence`,
        );
      }
    }

    // Both approved voices for every published pronunciation. Entry-level
    // audio cannot satisfy this: the API attaches audio to a pronunciation id.
    for (const pronunciation of enUs) {
      const voices = input.audioAssets
        .filter(
          (asset) =>
            asset.entryId === entry.entryId
            && asset.inputKind === 'pronunciation'
            && asset.inputRecordId === pronunciation.pronunciationId
            && asset.reviewStatus === 'accepted',
        )
        .map((asset) => `${asset.engineVoice}:${asset.publicVoiceId}`);
      for (const required of REQUIRED_VOICES) {
        const requiredBinding = `${required}:${REQUIRED_VOICE_BINDINGS[required]}`;
        if (!voices.includes(requiredBinding)) {
          block(
            'missing_voice_audio',
            `${entry.headword} pronunciation ${pronunciation.pronunciationId.slice(0, 8)} ` +
              `has no ${required}/${REQUIRED_VOICE_BINDINGS[required]} audio`,
          );
        }
      }
    }
  }

  // Translation, example and relation rows are independently authored records,
  // not mere child counts. Every one must carry the same evidence as a sense.
  const scopeForKind = {
    translation: 'translation',
    example: 'example',
    relation: 'relation',
  } as const;
  for (const record of input.authoredRecords) {
    const where = `${record.kind} ${record.recordId.slice(0, 8)}`;
    if (!record.authoredBy || !record.reviewedBy || !record.contentSha256) {
      block('missing_authorship', `${where} is missing author, reviewer or content hash`);
    }
    if (record.authoredBy && record.authoredBy === record.reviewedBy) {
      block('same_author_and_reviewer', `${where} was reviewed by its own author`);
    }
    if (!record.contentHashMatches) {
      block('content_hash_mismatch', `${where} content does not match its recorded hash`);
    }
    if (record.provenanceEventCount === 0) {
      block('missing_authorship', `${where} has no matching provenance event`);
    }
    if (!input.approvedScopesBySource[record.sourceId]?.includes(scopeForKind[record.kind])) {
      block(
        'unapproved_source',
        `${where}: source '${record.sourceId}' is not approved for ${scopeForKind[record.kind]}`,
      );
    }
    if (
      !record.authoredBy
      || input.contributorRightsEvidence[record.authoredBy] !== record.rightsEvidenceId
    ) {
      block(
        'missing_contributor_rights_evidence',
        `${where} has no matching author rights evidence`,
      );
    }
    if (record.reviewedBy && !input.contributorRightsEvidence[record.reviewedBy]) {
      block(
        'missing_contributor_rights_evidence',
        `${where} reviewer has no rights evidence`,
      );
    }
  }

  // ── 10. audio ─────────────────────────────────────────────────────────────
  const pronunciationOwners = new Map<string, string>();
  for (const entry of input.entries) {
    for (const pronunciation of entry.pronunciations) {
      pronunciationOwners.set(pronunciation.pronunciationId, entry.entryId);
    }
  }
  for (const asset of input.audioAssets) {
    const where = `audio ${asset.assetId.slice(0, 8)}`;

    if (asset.reviewStatus === 'quarantined') {
      block(
        'audio_unresolved_quarantine',
        `${where} conflicts with another recording for the same generation`,
      );
      continue;
    }

    if (
      asset.inputKind !== 'pronunciation'
      || pronunciationOwners.get(asset.inputRecordId) !== asset.entryId
    ) {
      block(
        'audio_stale_input',
        `${where}: input record is not a published pronunciation owned by its entry`,
      );
    }

    if (BLOCKED_VOICE_EVIDENCE.some((voice) => asset.engineVoice.includes(voice))) {
      block(
        'blocked_voice_evidence',
        `${where} was generated with the blocked voice ${asset.engineVoice}`,
      );
    }
    if (!asset.qaProof) {
      block('audio_missing_qa_proof', `${where} has no automated QA proof`);
    }
    if (asset.qaFindings.length > 0) {
      block('audio_missing_qa_proof', `${where} carries QA findings: ${asset.qaFindings.join(', ')}`);
    }
    if (!asset.reviewedBy || asset.reviewStatus !== 'accepted') {
      block(
        'audio_missing_listening_decision',
        `${where} has no individual human listening decision`,
      );
    }
    if (asset.reviewedBy && asset.reviewedBy === asset.generatorActor) {
      block('audio_self_review', `${where} was accepted by its generator`);
    }
    if (asset.reviewedBy && !input.contributorRightsEvidence[asset.reviewedBy]) {
      block(
        'missing_contributor_rights_evidence',
        `${where}: reviewer ${asset.reviewedBy} has no active rights evidence`,
      );
    }
    if (!/^sha256:[0-9a-f]{64}$/.test(asset.releaseRuntimeDigest ?? '')) {
      block('audio_unpinned_runtime', `${where} was not produced by a pinned release runtime`);
    }
    if (asset.inputTextSha256 !== asset.expectedInputTextSha256) {
      block('audio_stale_input', `${where} was generated from text other than the current headword`);
    }
    if (!asset.audioSha256) {
      block('audio_missing_object_hash', `${where} has no recorded object hash`);
    } else if (!asset.objectSha256) {
      block(
        'audio_object_missing_or_corrupt',
        `${where}: the object store was not verified for this asset`,
      );
    } else if (asset.objectSha256 !== asset.audioSha256) {
      block(
        'audio_object_missing_or_corrupt',
        `${where}: object bytes hash ${asset.objectSha256.slice(0, 12)}…, database says ` +
          `${asset.audioSha256.slice(0, 12)}…`,
      );
    }
    if (asset.trainingDatasetStatus !== 'approved') {
      block(
        'audio_missing_voice_rights',
        `${where}: voice rights are '${asset.trainingDatasetStatus}'`,
      );
    }
    const approvedEvidence = input.approvedVoiceEvidenceByEngine[asset.engineVoice] ?? [];
    if (
      !asset.voiceRightsEvidenceId
      || !approvedEvidence.includes(asset.voiceRightsEvidenceId)
    ) {
      block(
        'audio_missing_voice_rights',
        `${where}: no current approved voice-rights evidence matches ${asset.engineVoice}`,
      );
    }
  }

  // ── 11. similarity results ────────────────────────────────────────────────
  const currentPolicySha = input.similarityPolicy?.sha256 ?? '';
  const resultsByEntity = new Map<string, ReleaseSimilarityResult[]>();
  for (const result of input.similarityResults) {
    resultsByEntity.set(result.entityId, [
      ...(resultsByEntity.get(result.entityId) ?? []),
      result,
    ]);
  }

  const similarityTargets = [
    ...[...senseById].map(([entityId, sense]) => ({ entityId, contentSha256: sense.contentSha256 })),
    ...input.authoredRecords
      .filter((record) => record.kind === 'example')
      .map((record) => ({ entityId: record.recordId, contentSha256: record.contentSha256 })),
  ];
  for (const target of similarityTargets) {
    const senseId = target.entityId;
    const results = resultsByEntity.get(senseId) ?? [];
    const current = results.filter(
      (result) =>
        result.policySha256 === currentPolicySha && result.contentSha256 === target.contentSha256,
    );

    if (results.length === 0) {
      block('similarity_stale', `sense ${senseId.slice(0, 8)} has no similarity result`);
      continue;
    }
    if (current.length === 0) {
      // Either the text changed after the audit or the policy did. In both cases
      // nobody has checked what is actually going out.
      block(
        'similarity_stale',
        `sense ${senseId.slice(0, 8)} has no similarity result for its current content and policy`,
      );
      if (results.some((result) => result.policySha256 !== currentPolicySha)) {
        block(
          'similarity_policy_superseded',
          `the available similarity result for ${senseId.slice(0, 8)} uses a superseded policy`,
        );
      }
      continue;
    }

    for (const result of current) {
      if (result.matchClass === 'exact') {
        block('similarity_exact', `sense ${senseId.slice(0, 8)} is an exact match to legacy text`);
      } else if (
        (result.matchClass === 'high' || result.matchClass === 'medium') &&
        result.decision !== 'independently_authored_cleared'
      ) {
        block(
          'similarity_unresolved',
          `sense ${senseId.slice(0, 8)} is ${result.matchClass}/${result.decision} and not cleared`,
        );
      }
    }
  }

  // ── verdict ───────────────────────────────────────────────────────────────
  if (blockers.length > 0) {
    return {
      verdict: 'NO-GO',
      releaseId: input.releaseId,
      channel: input.channel,
      auditVersion: AUDIT_VERSION,
      blockers: dedupe(blockers),
      record: null,
    };
  }

  const senseCount = input.entries.reduce((total, entry) => total + entry.senses.length, 0);

  return {
    verdict: 'GO',
    releaseId: input.releaseId,
    channel: input.channel,
    auditVersion: AUDIT_VERSION,
    blockers: [],
    record: {
      releaseId: input.releaseId,
      channel: input.channel,
      auditVersion: AUDIT_VERSION,
      databaseSnapshot: input.snapshot,
      registryDigests: input.registryDigests,
      similarityPolicy: {
        version: input.similarityPolicy!.version,
        sha256: input.similarityPolicy!.sha256,
      },
      backupProofId: input.backupProof!.proofId,
      cleanRoomDeclarationId: input.governance.cleanRoomDeclarationId,
      rightsMatrixApprovalId: input.governance.rightsMatrixApprovalId,
      legalSignOffId: input.governance.legalSignOffId,
      territories: [...input.governance.targetTerritories].sort(),
      signerKeyId: input.signer.keyId,
      entryCount: input.publishedEntryCount,
      senseCount,
      audioAssetCount: input.audioAssets.length,
      auditedAt: input.now,
    },
  };
}

/** Same code and same detail twice adds nothing to a report. */
function dedupe(blockers: Blocker[]): Blocker[] {
  const seen = new Set<string>();
  return blockers.filter((blocker) => {
    const key = `${blocker.code}::${blocker.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Blocker codes present, in a stable order. Convenient for tests and reports. */
export function blockerCodes(result: ReleaseAuditResult): BlockerCode[] {
  return [...new Set(result.blockers.map((blocker) => blocker.code))].sort();
}
