import { RegistrySnapshot } from './lib/registry';
import {
  CandidateRow,
  EntryFacts,
  FORBIDDEN_IPA_SOURCES,
  IpaReviewFile,
  ipaContentHash,
  planIpaReview,
  validateIpaReviewFile,
} from './ipa-review';

const ENTRY = '11111111-1111-1111-1111-111111111111';
const CANDIDATE_A = '22222222-2222-2222-2222-222222222222';
const CANDIDATE_B = '33333333-3333-3333-3333-333333333333';

function registry(overrides: Partial<RegistrySnapshot> = {}): RegistrySnapshot {
  return {
    approvedScopesBySource: { 'dsd-ipa-original': ['pronunciation'] },
    contributors: {
      'DSD-A-001': { status: 'active', roles: ['author'], rightsEvidenceId: 'EV-IP-001' },
      'DSD-R-001': { status: 'active', roles: ['linguistic_reviewer'], rightsEvidenceId: 'EV-IP-010' },
    },
    ...overrides,
  };
}

function file(overrides: Partial<IpaReviewFile> = {}): IpaReviewFile {
  return {
    review_version: 1,
    batch_id: 'B-IPA-001',
    evidence_id: 'EV-IPA-001',
    records: [
      {
        dsd_entry_id: ENTRY,
        accent: 'en-US',
        ipa: 'rɪˈhɜːrs',
        priority: 1,
        authored_by: 'DSD-A-001',
        reviewed_by: 'DSD-R-001',
        review_notes: 'Checked against the vowel chart; stress on the second syllable.',
        source_id: 'dsd-ipa-original',
        rights_evidence_id: 'EV-IP-001',
        informed_by: [
          { tool_id: 'misaki', tool_revision: 'fba1236595f2', candidate_id: CANDIDATE_A },
        ],
        // One tool is always an escalation, so the baseline fixture
        // acknowledges it; the tests below remove it to prove that it fires.
        escalations_acknowledged: [
          'single tool: no independent candidate to disagree with',
        ],
      },
    ],
    ...overrides,
  };
}

function candidate(overrides: Partial<CandidateRow> = {}): CandidateRow {
  return {
    candidateId: CANDIDATE_A,
    entryId: ENTRY,
    accent: 'en-US',
    toolId: 'misaki',
    toolRevision: 'fba1236595f2',
    ipa: 'rɪˈhɜːrs',
    ...overrides,
  };
}

const entries: EntryFacts[] = [{ entryId: ENTRY, headword: 'rehearse', partsOfSpeech: ['verb'] }];

describe('validateIpaReviewFile', () => {
  it('accepts a well-formed file', () => {
    expect(validateIpaReviewFile(file(), registry())).toEqual([]);
  });

  it('refuses self-approval', () => {
    const bad = file();
    bad.records[0].reviewed_by = 'DSD-A-001';
    expect(validateIpaReviewFile(bad, registry()).join(' ')).toMatch(/cannot approve their own/);
  });

  it('requires review notes, because an approval with no reasoning is a rubber stamp', () => {
    const bad = file();
    bad.records[0].review_notes = '';
    expect(validateIpaReviewFile(bad, registry()).join(' ')).toMatch(/rubber stamp/);
  });

  it.each(FORBIDDEN_IPA_SOURCES)('refuses %s as a content source', (source) => {
    const bad = file();
    bad.records[0].source_id = source;
    expect(validateIpaReviewFile(bad, registry()).join(' ')).toMatch(/never a content source/);
  });

  it('refuses a source not approved for pronunciation', () => {
    const bad = file();
    bad.records[0].source_id = 'dsd-english-original';
    expect(validateIpaReviewFile(bad, registry()).join(' ')).toMatch(
      /not approved for scope 'pronunciation'/,
    );
  });

  it('refuses a transcription in another notation', () => {
    const bad = file();
    bad.records[0].ipa = 'rIh3rs';
    expect(validateIpaReviewFile(bad, registry()).join(' ')).toMatch(/unexpected symbols/);
  });

  it('refuses a record that tries to set its own status', () => {
    const bad: any = file();
    bad.records[0].status = 'approved';
    expect(validateIpaReviewFile(bad, registry()).join(' ')).toMatch(/forbidden field 'status'/);
  });

  it('requires informed_by to be present even when no tool was used', () => {
    const bad: any = file();
    delete bad.records[0].informed_by;
    expect(validateIpaReviewFile(bad, registry()).join(' ')).toMatch(/informed_by must be present/);
  });
});

describe('planIpaReview — provenance must be complete', () => {
  it('accepts a record that declares the one candidate that exists', () => {
    const plan = planIpaReview(file(), [candidate()], entries);
    expect(plan.blocked).toEqual([]);
    expect(plan.toInsert[0]).toMatchObject({ status: 'draft', accent: 'en-US' });
  });

  it('refuses a record that leaves an existing candidate out', () => {
    // The failure the whole file exists to prevent: tool-assisted work
    // presented as human-only by omission.
    const withTwo = [
      candidate(),
      candidate({ candidateId: CANDIDATE_B, toolId: 'microsoft-phonetic-matching' }),
    ];
    const plan = planIpaReview(file(), withTwo, entries);
    expect(plan.toInsert).toEqual([]);
    expect(plan.blocked.join(' ')).toMatch(/not declared in informed_by/);
    expect(plan.blocked.join(' ')).toMatch(/microsoft-phonetic-matching/);
  });

  it('refuses a record claiming a candidate that never existed', () => {
    const doc = file();
    // Declares the real candidate and an invented one, so this is not caught
    // by the undeclared-candidate rule.
    doc.records[0].informed_by = [
      { tool_id: 'misaki', tool_revision: 'x', candidate_id: CANDIDATE_A },
      { tool_id: 'ghost', tool_revision: 'x', candidate_id: CANDIDATE_B },
    ];
    expect(planIpaReview(doc, [candidate()], entries).blocked.join(' ')).toMatch(/do not exist/);
  });

  it('accepts a genuinely unassisted record when no candidate exists', () => {
    const doc = file();
    doc.records[0].informed_by = [];
    // No tools ran, so nothing to declare — but the single-tool escalation
    // still applies and must be acknowledged.
    doc.records[0].escalations_acknowledged = [
      'single tool: no independent candidate to disagree with',
    ];
    expect(planIpaReview(doc, [], entries).blocked).toEqual([]);
  });

  it('refuses an entry that does not exist', () => {
    expect(planIpaReview(file(), [candidate()], []).blocked.join(' ')).toMatch(/no such DSD entry/);
  });
});

describe('planIpaReview — escalations must be acknowledged', () => {
  const twoCandidates = [
    candidate({ ipa: 'ˈkɑntrækt' }),
    candidate({ candidateId: CANDIDATE_B, toolId: 'microsoft-phonetic-matching', ipa: 'kɑnˈtrækt' }),
  ];

  function declaringBoth(): IpaReviewFile {
    const doc = file();
    doc.records[0].informed_by = [
      { tool_id: 'misaki', tool_revision: 'x', candidate_id: CANDIDATE_A },
      { tool_id: 'microsoft-phonetic-matching', tool_revision: 'y', candidate_id: CANDIDATE_B },
    ];
    return doc;
  }

  it('blocks a disagreement nobody acknowledged', () => {
    expect(planIpaReview(declaringBoth(), twoCandidates, entries).blocked.join(' ')).toMatch(
      /unacknowledged escalation.*stress disagreement/,
    );
  });

  it('allows it once acknowledged word for word', () => {
    const doc = declaringBoth();
    doc.records[0].escalations_acknowledged = [
      'stress disagreement between misaki and microsoft-phonetic-matching',
    ];
    expect(planIpaReview(doc, twoCandidates, entries).blocked).toEqual([]);
  });

  it('blocks a homograph nobody acknowledged', () => {
    const homograph: EntryFacts[] = [
      { entryId: ENTRY, headword: 'record', partsOfSpeech: ['noun', 'verb'] },
    ];
    expect(planIpaReview(file(), [candidate()], homograph).blocked.join(' ')).toMatch(/homograph/);
  });

  it('blocks a proper name nobody acknowledged', () => {
    const name: EntryFacts[] = [
      { entryId: ENTRY, headword: 'Leicester', partsOfSpeech: ['noun'] },
    ];
    expect(planIpaReview(file(), [candidate()], name).blocked.join(' ')).toMatch(/proper name/);
  });

  it('blocks a single-tool record nobody acknowledged', () => {
    // One tool agreeing with itself is not evidence.
    const doc = file();
    doc.records[0].escalations_acknowledged = [];
    expect(planIpaReview(doc, [candidate()], entries).blocked.join(' ')).toMatch(/single tool/);
  });
});

describe('ipaContentHash', () => {
  it('is stable across notation differences', () => {
    expect(ipaContentHash({ accent: 'en-US', ipa: '/rɪˈhɜːrs/' })).toBe(
      ipaContentHash({ accent: 'en-US', ipa: "rɪ'hɜːrs" }),
    );
  });

  it('changes when the stress moves', () => {
    expect(ipaContentHash({ accent: 'en-US', ipa: 'ˈkɑntrækt' })).not.toBe(
      ipaContentHash({ accent: 'en-US', ipa: 'kɑnˈtrækt' }),
    );
  });
});
