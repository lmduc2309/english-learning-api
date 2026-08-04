import {
  AUDIT_VERSION,
  BlockerCode,
  ReleaseAuditInput,
  auditRelease,
  blockerCodes,
} from './dsd-release-audit';

const NOW = '2026-08-04T12:00:00.000Z';
const POLICY_SHA = 'p'.repeat(64);
const SENSE_HASH = 's'.repeat(64);
const AUDIO_HASH = 'a'.repeat(64);
const ENTRY_ID = '11111111-1111-1111-1111-111111111111';
const SENSE_ID = '22222222-2222-2222-2222-222222222222';

/**
 * A synthetic corpus that should audit clean.
 *
 * Every test below is this fixture with exactly one thing wrong, which is the
 * only way to be confident a blocker fires for its own reason rather than as a
 * side effect of another.
 */
function clean(): ReleaseAuditInput {
  return {
    releaseId: 'DSD-REL-V1-5000-a1b2c3d4',
    channel: 'public',
    releaseIdIsPublicEligible: true,
    now: NOW,
    snapshot: { database: 'dsd_corpus_db', migrationVersion: '1785629400000', takenAt: NOW },
    registryDigests: { source: '1'.repeat(64), tool: '2'.repeat(64), contributor: '3'.repeat(64) },
    similarityPolicy: {
      version: 'v1',
      sha256: POLICY_SHA,
      approvers: ['DSD-P-001', 'DSD-R-001', 'DSD-L-001'],
    },
    entries: [
      {
        entryId: ENTRY_ID,
        headword: 'rehearse',
        senses: [
          {
            senseId: SENSE_ID,
            definitionEn: 'To practise a performance before presenting it.',
            authoredBy: 'DSD-A-001',
            reviewedBy: 'DSD-R-001',
            contentSha256: SENSE_HASH,
            sourceId: 'dsd-english-original',
            provenanceEventCount: 3,
            approvedVietnameseCount: 1,
            approvedExampleCount: 2,
            fields: ['id', 'definition_en', 'part_of_speech'],
          },
        ],
        pronunciations: [
          {
            pronunciationId: 'p1',
            accent: 'en-US',
            ipa: 'rɪˈhɜːrs',
            authoredBy: 'DSD-A-002',
            reviewedBy: 'DSD-R-001',
          },
        ],
      },
    ],
    audioAssets: [
      {
        assetId: 'aud-ljspeech-0001',
        entryId: ENTRY_ID,
        engineVoice: 'en_US-ljspeech-medium',
        publicVoiceId: 'en-aria',
        qaFindings: [],
        qaProof: true,
        reviewedBy: 'DSD-R-002',
        audioSha256: AUDIO_HASH,
        objectSha256: AUDIO_HASH,
        trainingDatasetStatus: 'approved',
        reviewStatus: 'accepted',
      },
      {
        assetId: 'aud-norman-0001',
        entryId: ENTRY_ID,
        engineVoice: 'en_US-norman-medium',
        publicVoiceId: 'en-guy',
        qaFindings: [],
        qaProof: true,
        reviewedBy: 'DSD-R-002',
        audioSha256: 'b'.repeat(64),
        objectSha256: 'b'.repeat(64),
        trainingDatasetStatus: 'approved',
        reviewStatus: 'accepted',
      },
    ],
    similarityResults: [
      {
        entityId: SENSE_ID,
        matchClass: 'low',
        decision: 'clear',
        contentSha256: SENSE_HASH,
        policySha256: POLICY_SHA,
      },
    ],
    qualityFindings: [{ severity: 'warning', rule: 'defines_with_headword', entityId: SENSE_ID }],
    toolArtifacts: [
      { toolId: 'misaki', revision: 'fba1236', artifactSha256: 'c'.repeat(64), mutable: false },
    ],
    approvedScopesBySource: {
      'dsd-english-original': ['definition', 'example'],
      'dsd-vietnamese-original': ['translation'],
    },
    approvedToolIds: ['misaki'],
    contributorRightsEvidence: {
      'DSD-A-001': 'EV-IP-001',
      'DSD-A-002': 'EV-IP-002',
      'DSD-R-001': 'EV-IP-010',
      'DSD-R-002': 'EV-IP-011',
    },
    governance: {
      cleanRoomDeclarationId: 'DSD-DECL-20260804-001',
      rightsMatrixApprovalId: 'EV-RIGHTS-001',
      legalSignOffId: 'EV-LEGAL-001',
      targetTerritories: ['VN', 'SG'],
      approvedTerritories: ['VN', 'SG', 'MY'],
    },
    backupProof: {
      proofId: 'BK-20260804-01',
      verifiedAt: '2026-08-04T06:00:00.000Z',
      offHostCopy: true,
      migrationVersion: '1785629400000',
    },
    restoreMaxAgeHours: 24,
    signer: { keyId: 'DSD-SIGN-001', registryStatus: 'active' },
  };
}

/** Apply one mutation and audit. */
function auditWith(mutate: (input: ReleaseAuditInput) => void) {
  const input = clean();
  mutate(input);
  return auditRelease(input);
}

describe('a clean corpus', () => {
  it('returns GO', () => {
    const result = auditRelease(clean());
    expect(result.blockers).toEqual([]);
    expect(result.verdict).toBe('GO');
  });

  it('records everything needed to reconstruct the decision', () => {
    // A GO nobody can reconstruct six months later is not evidence of anything.
    const record = auditRelease(clean()).record!;
    expect(record).toMatchObject({
      releaseId: 'DSD-REL-V1-5000-a1b2c3d4',
      channel: 'public',
      auditVersion: AUDIT_VERSION,
      backupProofId: 'BK-20260804-01',
      cleanRoomDeclarationId: 'DSD-DECL-20260804-001',
      rightsMatrixApprovalId: 'EV-RIGHTS-001',
      legalSignOffId: 'EV-LEGAL-001',
      signerKeyId: 'DSD-SIGN-001',
      entryCount: 1,
      senseCount: 1,
      audioAssetCount: 2,
    });
    expect(record.databaseSnapshot.migrationVersion).toBe('1785629400000');
    expect(record.registryDigests.source).toMatch(/^[0-9a-f]{64}$/);
    expect(record.similarityPolicy.sha256).toBe(POLICY_SHA);
    // Sorted, so two audits of the same release produce the same record.
    expect(record.territories).toEqual(['SG', 'VN']);
  });

  it('carries no record on NO-GO', () => {
    const result = auditWith((input) => {
      input.entries = [];
    });
    expect(result.verdict).toBe('NO-GO');
    expect(result.record).toBeNull();
  });

  it('stamps its own implementation version either way', () => {
    expect(auditRelease(clean()).auditVersion).toBe(AUDIT_VERSION);
    expect(auditWith((i) => { i.entries = []; }).auditVersion).toBe(AUDIT_VERSION);
  });
});

/**
 * One fixture per blocker.
 *
 * Each mutation breaks exactly one thing, and the assertion is that the expected
 * code appears — not that it is the only code, since some breakages legitimately
 * imply others (an entry with no senses also has no similarity result).
 */
interface BlockerFixture {
  code: BlockerCode;
  mutate: (input: ReleaseAuditInput) => void;
  detail: string;
}

// Objects rather than tuples: with a tuple whose last element is optional, jest
// passes its own `done` callback as the missing third argument.
const BLOCKER_FIXTURES: BlockerFixture[] = [
  { code: 'no_published_entries', mutate: (i) => { i.entries = []; }, detail: 'no published entries' },
  { code: 'unapproved_source', mutate: (i) => { i.entries[0].senses[0].sourceId = 'oewn-2025'; }, detail: 'not approved for definitions' },
  { code: 'unapproved_tool', mutate: (i) => { i.toolArtifacts[0].toolId = 'some-unvetted-g2p'; }, detail: 'is not approved' },
  { code: 'legacy_reference', mutate: (i) => { i.entries[0].senses[0].fields = ['id', 'word_id']; }, detail: "legacy field 'word_id'" },
  { code: 'missing_authorship', mutate: (i) => { i.entries[0].senses[0].reviewedBy = null; }, detail: 'a reviewer' },
  { code: 'missing_authorship', mutate: (i) => { i.entries[0].senses[0].provenanceEventCount = 0; }, detail: 'no provenance event' },
  { code: 'same_author_and_reviewer', mutate: (i) => { i.entries[0].senses[0].reviewedBy = 'DSD-A-001'; }, detail: 'reviewed by its own author' },
  { code: 'missing_translation', mutate: (i) => { i.entries[0].senses[0].approvedVietnameseCount = 0; }, detail: 'no approved Vietnamese' },
  { code: 'missing_example', mutate: (i) => { i.entries[0].senses[0].approvedExampleCount = 0; }, detail: 'no approved bilingual example' },
  { code: 'missing_ipa', mutate: (i) => { i.entries[0].pronunciations = []; }, detail: 'no approved en-US IPA' },
  { code: 'missing_ipa', mutate: (i) => { i.entries[0].pronunciations[0].accent = 'en-GB'; }, detail: 'no approved en-US IPA' },
  { code: 'missing_voice_audio', mutate: (i) => { i.audioAssets = i.audioAssets.filter((a) => a.engineVoice.includes('ljspeech')); }, detail: 'no en_US-norman-medium audio' },
  { code: 'missing_voice_audio', mutate: (i) => { i.audioAssets = i.audioAssets.filter((a) => a.engineVoice.includes('norman')); }, detail: 'no en_US-ljspeech-medium audio' },
  { code: 'audio_missing_qa_proof', mutate: (i) => { i.audioAssets[0].qaProof = false; }, detail: 'no automated QA proof' },
  { code: 'audio_missing_qa_proof', mutate: (i) => { i.audioAssets[0].qaFindings = ['clipping']; }, detail: 'carries QA findings' },
  { code: 'audio_missing_listening_decision', mutate: (i) => { i.audioAssets[0].reviewedBy = null; }, detail: 'no individual human listening decision' },
  { code: 'audio_missing_listening_decision', mutate: (i) => { i.audioAssets[0].reviewStatus = 'awaiting_review'; }, detail: 'no individual human listening decision' },
  { code: 'audio_missing_object_hash', mutate: (i) => { i.audioAssets[0].audioSha256 = null; }, detail: 'no recorded object hash' },
  { code: 'audio_object_missing_or_corrupt', mutate: (i) => { i.audioAssets[0].objectSha256 = null; }, detail: 'object store was not verified' },
  { code: 'audio_object_missing_or_corrupt', mutate: (i) => { i.audioAssets[0].objectSha256 = 'f'.repeat(64); }, detail: 'database says' },
  { code: 'audio_missing_voice_rights', mutate: (i) => { i.audioAssets[0].trainingDatasetStatus = 'pending'; }, detail: "voice rights are 'pending'" },
  { code: 'blocked_voice_evidence', mutate: (i) => { i.audioAssets[0].engineVoice = 'en_US-amy-medium'; }, detail: 'blocked voice' },
  { code: 'blocked_voice_evidence', mutate: (i) => { i.audioAssets[0].engineVoice = 'en_US-lessac-medium'; }, detail: 'blocked voice' },
  { code: 'similarity_exact', mutate: (i) => { i.similarityResults[0].matchClass = 'exact'; }, detail: 'exact match to legacy text' },
  { code: 'similarity_unresolved', mutate: (i) => {
      i.similarityResults[0].matchClass = 'high';
      i.similarityResults[0].decision = 'manual_review';
    }, detail: 'not cleared' },
  { code: 'similarity_stale', mutate: (i) => { i.similarityResults = []; }, detail: 'no similarity result' },
  { code: 'similarity_stale', mutate: (i) => { i.similarityResults[0].contentSha256 = 'z'.repeat(64); }, detail: 'current content and policy' },
  { code: 'similarity_policy_superseded', mutate: (i) => { i.similarityResults[0].policySha256 = 'y'.repeat(64); }, detail: 'superseded policy' },
  { code: 'similarity_policy_superseded', mutate: (i) => { i.similarityPolicy = null; }, detail: 'no approved similarity policy' },
  { code: 'similarity_policy_superseded', mutate: (i) => { i.similarityPolicy!.approvers = ['DSD-P-001']; }, detail: 'three are required' },
  { code: 'critical_quality_finding', mutate: (i) => { i.qualityFindings.push({ severity: 'critical', rule: 'raw_markup', entityId: SENSE_ID }); }, detail: 'raw_markup' },
  { code: 'mutable_tool_artifact', mutate: (i) => { i.toolArtifacts[0].mutable = true; }, detail: 'a mutable artifact' },
  { code: 'mutable_tool_artifact', mutate: (i) => { i.toolArtifacts[0].artifactSha256 = null; }, detail: 'no artifact digest' },
  { code: 'candidate_exposed_as_content', mutate: (i) => { i.entries[0].pronunciations[0].isGeneratedCandidate = true; }, detail: 'generated IPA candidate is the final pronunciation record' },
  { code: 'missing_contributor_rights_evidence', mutate: (i) => { delete i.contributorRightsEvidence['DSD-A-001']; }, detail: 'no rights evidence on file' },
  { code: 'missing_clean_room_declaration', mutate: (i) => { i.governance.cleanRoomDeclarationId = ''; }, detail: 'no clean-room declaration' },
  { code: 'missing_rights_matrix_approval', mutate: (i) => { i.governance.rightsMatrixApprovalId = ''; }, detail: 'no recorded approval' },
  { code: 'missing_legal_signoff', mutate: (i) => { i.governance.legalSignOffId = ''; }, detail: 'no legal sign-off' },
  { code: 'missing_territory_approval', mutate: (i) => { i.governance.targetTerritories = []; }, detail: 'no release territories' },
  { code: 'missing_territory_approval', mutate: (i) => { i.governance.targetTerritories = ['VN', 'US']; }, detail: 'territories not approved: US' },
  { code: 'backup_proof_missing', mutate: (i) => { i.backupProof = null; }, detail: 'no verified backup/restore proof' },
  { code: 'backup_proof_stale', mutate: (i) => { i.backupProof!.verifiedAt = '2026-08-01T06:00:00.000Z'; }, detail: 'older than the 24h limit' },
  { code: 'backup_proof_no_off_host_copy', mutate: (i) => { i.backupProof!.offHostCopy = false; }, detail: 'no off-host copy' },
  { code: 'backup_proof_migration_mismatch', mutate: (i) => { i.backupProof!.migrationVersion = '1785628800000'; }, detail: 'the proof covers migration' },
  { code: 'release_channel_policy_violation', mutate: (i) => { i.releaseIdIsPublicEligible = false; }, detail: 'not public-eligible' },
  { code: 'signer_key_unknown', mutate: (i) => { i.signer.registryStatus = null; }, detail: 'no entry in the public-key registry' },
  { code: 'signer_key_unknown', mutate: (i) => { i.signer.keyId = ''; }, detail: 'public-key registry' },
  { code: 'signer_key_revoked', mutate: (i) => { i.signer.registryStatus = 'revoked'; }, detail: 'is revoked' },
];

describe('every blocker returns NO-GO with a specific reason', () => {
  it.each(BLOCKER_FIXTURES)('$code — $detail', ({ code, mutate, detail }) => {
    const result = auditWith(mutate);
    expect(result.verdict).toBe('NO-GO');
    expect(blockerCodes(result)).toContain(code);
    if (detail) {
      const details = result.blockers
        .filter((blocker) => blocker.code === code)
        .map((blocker) => blocker.detail)
        .join(' ');
      expect(details).toContain(detail);
    }
  });

  it('covers every blocker code the module declares', () => {
    // A blocker with no fixture is a blocker nobody has seen fire.
    const covered = new Set(BLOCKER_FIXTURES.map((fixture) => fixture.code));
    const declared: BlockerCode[] = [
      'no_published_entries', 'unapproved_source', 'unapproved_tool', 'legacy_reference',
      'missing_authorship', 'same_author_and_reviewer', 'missing_translation', 'missing_example',
      'missing_ipa', 'missing_voice_audio', 'audio_missing_qa_proof',
      'audio_missing_listening_decision', 'audio_missing_object_hash',
      'audio_missing_voice_rights', 'audio_object_missing_or_corrupt', 'blocked_voice_evidence',
      'similarity_exact', 'similarity_unresolved', 'similarity_stale',
      'similarity_policy_superseded', 'critical_quality_finding', 'mutable_tool_artifact',
      'candidate_exposed_as_content', 'missing_contributor_rights_evidence',
      'missing_clean_room_declaration', 'missing_rights_matrix_approval',
      'missing_territory_approval', 'missing_legal_signoff', 'backup_proof_missing',
      'backup_proof_stale', 'backup_proof_no_off_host_copy', 'backup_proof_migration_mismatch',
      'release_channel_policy_violation', 'signer_key_unknown', 'signer_key_revoked',
    ];
    for (const code of declared) {
      expect([...covered]).toContain(code);
    }
  });
});

describe('the internal channel', () => {
  it('accepts a release that is not public-eligible', () => {
    // A pilot is exactly what the internal channel is for.
    const result = auditWith((input) => {
      input.channel = 'internal';
      input.releaseId = 'DSD-REL-PILOT-20260804-a1b2c3d4';
      input.releaseIdIsPublicEligible = false;
    });
    expect(result.verdict).toBe('GO');
  });

  it('still enforces every content and evidence blocker', () => {
    const result = auditWith((input) => {
      input.channel = 'internal';
      input.releaseIdIsPublicEligible = false;
      input.entries[0].senses[0].approvedVietnameseCount = 0;
      input.governance.legalSignOffId = '';
    });
    expect(blockerCodes(result)).toEqual(
      expect.arrayContaining(['missing_translation', 'missing_legal_signoff']),
    );
  });
});

describe('reporting', () => {
  it('reports every blocker at once, not the first', () => {
    const result = auditWith((input) => {
      input.entries[0].senses[0].approvedVietnameseCount = 0;
      input.entries[0].senses[0].approvedExampleCount = 0;
      input.governance.legalSignOffId = '';
      input.backupProof = null;
    });
    expect(blockerCodes(result).length).toBeGreaterThanOrEqual(4);
  });

  it('does not repeat an identical blocker', () => {
    const result = auditWith((input) => {
      input.audioAssets[0].qaProof = false;
      input.audioAssets[1].qaProof = false;
    });
    const details = result.blockers.filter((b) => b.code === 'audio_missing_qa_proof');
    // Two assets, two distinct details — deduped by detail, not collapsed by code.
    expect(details).toHaveLength(2);
    expect(new Set(details.map((d) => d.detail)).size).toBe(2);
  });

  it('is deterministic', () => {
    const first = auditRelease(clean());
    const second = auditRelease(clean());
    expect(first).toEqual(second);
  });

  it('names no contributor in a blocker unless the blocker is about them', () => {
    // The report is read by people who need not know who wrote what.
    const result = auditWith((input) => {
      input.entries[0].senses[0].approvedVietnameseCount = 0;
    });
    const translation = result.blockers.find((b) => b.code === 'missing_translation')!;
    expect(translation.detail).not.toMatch(/DSD-A-|DSD-R-/);
  });
});
