import { RegistrySnapshot } from './lib/registry';
import {
  FORBIDDEN_DECISION_FIELDS,
  EntrySnapshot,
  GateResult,
  PublishableRecord,
  QueueSourceRow,
  ReviewDecisionsFile,
  ReviewableRow,
  buildQueue,
  evaluateEntryPublication,
  similarityGate,
  planReviewApply,
  qualityGate,
  rollupEntryStatus,
  validateDecisionsFile,
} from './review';
import { QualityInput } from './quality-audit';

const SENSE_ID = '11111111-1111-1111-1111-111111111111';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function registry(overrides: Partial<RegistrySnapshot> = {}): RegistrySnapshot {
  return {
    approvedScopesBySource: {},
    contributors: {
      'DSD-A-001': { status: 'active', roles: ['author'], rightsEvidenceId: 'EV-IP-001' },
      'DSD-R-001': { status: 'active', roles: ['linguistic_reviewer'], rightsEvidenceId: 'EV-IP-010' },
    },
    blockedSourceNames: ['oewn-2025', 'wiktionary-en'],
    ...overrides,
  };
}

function decisions(overrides: Partial<ReviewDecisionsFile> = {}): ReviewDecisionsFile {
  return {
    decisions_version: 1,
    queue_id: 'Q-B-001-20260802',
    batch_id: 'B-001',
    reviewer_id: 'DSD-R-001',
    decision_evidence_id: 'EV-REV-001',
    decisions: [
      {
        entity_kind: 'sense',
        entity_id: SENSE_ID,
        content_sha256: HASH_A,
        decision: 'approve',
      },
    ],
    ...overrides,
  };
}

function row(overrides: Partial<ReviewableRow> = {}): ReviewableRow {
  return {
    entityKind: 'sense',
    entityId: SENSE_ID,
    contentSha256: HASH_A,
    status: 'in_review',
    authoredBy: 'DSD-A-001',
    ...overrides,
  };
}

describe('buildQueue', () => {
  const source: QueueSourceRow = {
    entityKind: 'sense',
    entityId: SENSE_ID,
    headword: 'rehearse',
    senseKey: 's1',
    partOfSpeech: 'verb',
    content: ['To practise something before performing it.'],
    contentSha256: HASH_A,
    authoredBy: 'DSD-A-001',
    status: 'in_review',
  };

  it('carries the content hash, so a decision can be bound to it', () => {
    const queue = buildQueue('B-001', '2026-08-02T09:00:00.000Z', [source]);
    expect(queue.items[0].content_sha256).toBe(HASH_A);
    expect(queue.queue_id).toContain('B-001');
  });

  it('shows the author, so a reviewer can decline their own work', () => {
    expect(buildQueue('B-001', '2026-08-02T09:00:00.000Z', [source]).items[0].authored_by).toBe(
      'DSD-A-001',
    );
  });

  it('has no field capable of holding legacy comparison text', () => {
    // The point of the review is that the DSD wording was reached without
    // seeing anyone else's. A comparison column would end that.
    const item = buildQueue('B-001', '2026-08-02T09:00:00.000Z', [source]).items[0];
    for (const forbidden of [
      'legacy', 'legacy_text', 'comparison', 'source_text', 'similarity', 'similarity_score',
      'oewn', 'wiktionary', 'suggested_text',
    ]) {
      expect(Object.keys(item)).not.toContain(forbidden);
    }
    expect(JSON.stringify(item)).not.toMatch(/legacy|similarity|oewn|wiktionary/i);
  });

  it('is deterministic for the same input', () => {
    expect(buildQueue('B-001', '2026-08-02T09:00:00.000Z', [source])).toEqual(
      buildQueue('B-001', '2026-08-02T09:00:00.000Z', [source]),
    );
  });
});

describe('validateDecisionsFile', () => {
  it('accepts a well-formed file', () => {
    expect(validateDecisionsFile(decisions(), registry())).toEqual([]);
  });

  it('requires the evidence ID the provenance event will point at', () => {
    // The ledger has no free-text column, so the notes live in the committed
    // decisions file and the event references it.
    expect(
      validateDecisionsFile(decisions({ decision_evidence_id: '' }), registry()).join(' '),
    ).toMatch(/decision_evidence_id/);
  });

  it('requires a content hash on every decision', () => {
    const bad = decisions();
    (bad.decisions[0] as any).content_sha256 = '';
    expect(validateDecisionsFile(bad, registry()).join(' ')).toMatch(/exact text/i);
  });

  it('rejects an unknown reviewer', () => {
    expect(
      validateDecisionsFile(decisions({ reviewer_id: 'DSD-R-999' }), registry()).join(' '),
    ).toMatch(/not in the contributor registry/i);
  });

  it('rejects a reviewer who only holds the author role', () => {
    expect(
      validateDecisionsFile(decisions({ reviewer_id: 'DSD-A-001' }), registry()).join(' '),
    ).toMatch(/does not hold a reviewer role/i);
  });

  it('rejects an inactive reviewer', () => {
    const reg = registry();
    reg.contributors['DSD-R-001'].status = 'revoked';
    expect(validateDecisionsFile(decisions(), reg).join(' ')).toMatch(/not active/i);
  });

  it('requires guidance on a rejection', () => {
    const bad = decisions();
    bad.decisions[0].decision = 'reject';
    expect(validateDecisionsFile(bad, registry()).join(' ')).toMatch(/guidance/i);
  });

  it.each(FORBIDDEN_DECISION_FIELDS)('rejects the field %s', (field) => {
    const bad: any = decisions();
    bad.decisions[0][field] = 'x';
    expect(validateDecisionsFile(bad, registry()).join(' ')).toMatch(
      new RegExp(`forbidden field '${field}'`, 'i'),
    );
  });

  it('will not let a reviewer supply replacement wording', () => {
    // Rewriting is authoring, and an author cannot review their own work.
    for (const field of ['definition_en', 'suggested_text', 'rewrite']) {
      const bad: any = decisions();
      bad.decisions[0][field] = 'A better definition.';
      expect(validateDecisionsFile(bad, registry()).join(' ')).toMatch(/never replacement wording/i);
    }
  });

  it('rejects notes that link out', () => {
    const bad = decisions();
    bad.decisions[0].notes = 'See https://en.wiktionary.org/wiki/rehearse for the right phrasing.';
    expect(validateDecisionsFile(bad, registry()).join(' ')).toMatch(/link/i);
  });

  it('rejects notes that point an author at a blocked source', () => {
    const bad = decisions();
    bad.decisions[0].notes = 'Word it the way oewn-2025 does.';
    expect(validateDecisionsFile(bad, registry()).join(' ')).toMatch(/cite blocked source/i);
  });

  it('accepts ordinary DSD-specific guidance', () => {
    const good = decisions();
    good.decisions[0].decision = 'reject';
    good.decisions[0].notes = 'Too broad — name the rehearsal context and drop "generally".';
    expect(validateDecisionsFile(good, registry())).toEqual([]);
  });
});

describe('planReviewApply', () => {
  it('applies an approval to an in-review record', () => {
    const plan = planReviewApply(decisions(), [row()]);
    expect(plan.blocked).toEqual([]);
    expect(plan.toApply[0]).toMatchObject({ toStatus: 'approved', event: 'approved' });
  });

  it('refuses a stale decision', () => {
    // Content changed after the queue was generated: the reviewer approved
    // words that are no longer there.
    const plan = planReviewApply(decisions(), [row({ contentSha256: HASH_B })]);
    expect(plan.toApply).toEqual([]);
    expect(plan.blocked.join(' ')).toMatch(/stale/i);
  });

  it('refuses self-review', () => {
    const plan = planReviewApply(decisions(), [row({ authoredBy: 'DSD-R-001' })]);
    expect(plan.toApply).toEqual([]);
    expect(plan.blocked.join(' ')).toMatch(/cannot review it/i);
  });

  it('refuses a skipped state', () => {
    const plan = planReviewApply(decisions(), [row({ status: 'draft' })]);
    expect(plan.blocked.join(' ')).toMatch(/skip 'in_review'/);
  });

  it('refuses to re-decide something already approved', () => {
    const plan = planReviewApply(decisions(), [row({ status: 'approved' })]);
    expect(plan.toApply).toEqual([]);
    expect(plan.blocked.length).toBe(1);
  });

  it('refuses a record that is not in DSD', () => {
    expect(planReviewApply(decisions(), []).blocked.join(' ')).toMatch(/no such DSD record/i);
  });

  it('refuses the same record decided twice in one file', () => {
    const doc = decisions();
    doc.decisions.push({ ...doc.decisions[0], decision: 'reject', notes: 'no' });
    expect(planReviewApply(doc, [row()]).blocked.join(' ')).toMatch(/decided twice/i);
  });

  it('carries the reviewer and evidence through to the writer', () => {
    const plan = planReviewApply(decisions(), [row()]);
    expect(plan.reviewerId).toBe('DSD-R-001');
    expect(plan.evidenceId).toBe('EV-REV-001');
  });
});

describe('rollupEntryStatus', () => {
  it('moves an entry to in_review once its content is submitted', () => {
    expect(rollupEntryStatus('draft', ['in_review', 'draft'])).toBe('in_review');
  });

  it('moves to approved only when every live record is approved', () => {
    expect(rollupEntryStatus('in_review', ['approved', 'in_review'])).toBe('in_review');
    expect(rollupEntryStatus('in_review', ['approved', 'approved'])).toBe('approved');
  });

  it('ignores rejected and retired records', () => {
    expect(rollupEntryStatus('in_review', ['approved', 'rejected'])).toBe('approved');
  });

  it('never moves an entry backwards', () => {
    // A new draft sense must not pull a published entry back into review.
    expect(rollupEntryStatus('published', ['published', 'draft'])).toBe('published');
    expect(rollupEntryStatus('approved', ['draft'])).toBe('approved');
  });

  it('leaves an entry with no live content alone', () => {
    expect(rollupEntryStatus('draft', [])).toBe('draft');
    expect(rollupEntryStatus('draft', ['rejected'])).toBe('draft');
  });
});

describe('evaluateEntryPublication', () => {
  const pass: GateResult[] = [
    { gate: 'quality', status: 'pass', detail: '' },
    { gate: 'similarity', status: 'pass', detail: '' },
  ];

  function record(overrides: Partial<PublishableRecord> = {}): PublishableRecord {
    return {
      entityKind: 'translation',
      entityId: '22222222-2222-2222-2222-222222222222',
      status: 'approved',
      contentSha256: HASH_A,
      authoredBy: 'DSD-A-002',
      reviewedBy: 'DSD-R-001',
      approvals: [{ actor: 'DSD-R-001', outputHash: HASH_A }],
      ...overrides,
    };
  }

  function snapshot(overrides: Partial<EntrySnapshot> = {}): EntrySnapshot {
    return {
      entryId: SENSE_ID,
      headword: 'rehearse',
      entryStatus: 'approved',
      senses: [
        {
          ...record({ entityKind: 'sense', entityId: SENSE_ID, authoredBy: 'DSD-A-001' }),
          entityKind: 'sense',
          senseKey: 's1',
          translations: [record()],
          examples: [record({ entityKind: 'example' })],
        },
      ],
      ...overrides,
    };
  }

  it('passes a complete, independently reviewed, gated entry', () => {
    expect(evaluateEntryPublication(snapshot(), pass)).toEqual([]);
  });

  it('blocks when a gate has not run', () => {
    // Fail closed: not_run is not a pass, and Task 8 is not built yet.
    const blocked = evaluateEntryPublication(snapshot(), [
      similarityGate([{ entityKind: 'sense', entityId: SENSE_ID, contentSha256: HASH_A }], [], null),
    ]);
    expect(blocked.join(' ')).toMatch(/gate 'similarity': not_run/);
    expect(blocked.join(' ')).toMatch(/no approved similarity policy/);
  });

  it('blocks when a gate fails', () => {
    const blocked = evaluateEntryPublication(snapshot(), [
      { gate: 'similarity', status: 'fail', detail: 'exact match on 1 definition' },
    ]);
    expect(blocked.join(' ')).toMatch(/exact match/);
  });

  it('blocks an entry that is not itself approved', () => {
    expect(
      evaluateEntryPublication(snapshot({ entryStatus: 'in_review' }), pass).join(' '),
    ).toMatch(/not approved/);
  });

  it('blocks a sense with no approved translation', () => {
    const s = snapshot();
    s.senses[0].translations = [];
    expect(evaluateEntryPublication(s, pass).join(' ')).toMatch(/no approved Vietnamese/i);
  });

  it('blocks a sense with no approved example', () => {
    const s = snapshot();
    s.senses[0].examples = [record({ entityKind: 'example', status: 'draft' })];
    expect(evaluateEntryPublication(s, pass).join(' ')).toMatch(/no approved example/i);
  });

  it('blocks an entry with no senses', () => {
    expect(evaluateEntryPublication(snapshot({ senses: [] }), pass).join(' ')).toMatch(
      /has no senses/i,
    );
  });

  it('blocks a record approved by its own author', () => {
    const s = snapshot();
    s.senses[0].reviewedBy = 'DSD-A-001';
    s.senses[0].approvals = [{ actor: 'DSD-A-001', outputHash: HASH_A }];
    expect(evaluateEntryPublication(s, pass).join(' ')).toMatch(/reviewed by its own author/i);
  });

  it('blocks a record whose approval event names different content', () => {
    // The status says approved but the ledger approved other words: the row was
    // edited after review, or the status was set outside the workflow.
    const s = snapshot();
    s.senses[0].approvals = [{ actor: 'DSD-R-001', outputHash: HASH_B }];
    expect(evaluateEntryPublication(s, pass).join(' ')).toMatch(/no approval event for content/i);
  });

  it('blocks a record with an approved status and no ledger entry at all', () => {
    const s = snapshot();
    s.senses[0].approvals = [];
    expect(evaluateEntryPublication(s, pass).join(' ')).toMatch(/outside the workflow/i);
  });

  it('blocks when the approval actor is not the recorded reviewer', () => {
    const s = snapshot();
    s.senses[0].approvals = [{ actor: 'DSD-R-002', outputHash: HASH_A }];
    expect(evaluateEntryPublication(s, pass).join(' ')).toMatch(/does not match reviewed_by/i);
  });

  it('reports every reason at once rather than the first', () => {
    const s = snapshot({ entryStatus: 'draft' });
    s.senses[0].translations = [];
    s.senses[0].examples = [];
    const blocked = evaluateEntryPublication(s, [
      similarityGate([], [], null),
    ]).join(' ');
    expect(blocked).toMatch(/not approved/);
    expect(blocked).toMatch(/no approved Vietnamese/);
    expect(blocked).toMatch(/no approved example/);
    expect(blocked).toMatch(/gate 'similarity'/);
  });
});

describe('qualityGate', () => {
  function content(overrides: Partial<QualityInput> = {}): QualityInput {
    return {
      definitions: [
        {
          entityId: 'd1',
          headword: 'rehearse',
          partOfSpeech: 'verb',
          definitionEn: 'To practise a performance before presenting it to an audience.',
          usageLabels: ['general'],
        },
      ],
      translations: [
        {
          entityId: 't1',
          headword: 'rehearse',
          definitionEn: 'To practise a performance before presenting it to an audience.',
          locale: 'vi',
          text: 'diễn tập',
        },
      ],
      examples: [
        {
          entityId: 'x1',
          headword: 'rehearse',
          partOfSpeech: 'verb',
          exampleEn: 'The choir rehearses every Thursday evening.',
          exampleVi: 'Dàn hợp xướng diễn tập vào mỗi tối thứ Năm.',
        },
      ],
      ...overrides,
    };
  }

  it('passes clean content', () => {
    expect(qualityGate(content())).toMatchObject({ status: 'pass', detail: 'no findings' });
  });

  it('fails on a critical finding and names it', () => {
    const bad = content();
    bad.translations[0].text = 'rehearse';
    const gate = qualityGate(bad);
    expect(gate.status).toBe('fail');
    expect(gate.detail).toMatch(/headword_echo on t1/);
  });

  it('passes with warnings, but reports that there were some', () => {
    // A warning must not silently become an approval, and it must not silently
    // become a block either. It is counted and shown.
    const warned = content();
    warned.examples[0].exampleEn = 'the choir rehearses every Thursday';
    const gate = qualityGate(warned);
    expect(gate.status).toBe('pass');
    expect(gate.detail).toMatch(/warning/);
  });

  it('blocks publication when it fails', () => {
    const bad = content();
    bad.definitions[0].definitionEn = 'To rehearse.';
    expect(
      evaluateEntryPublication(
        {
          entryId: SENSE_ID,
          headword: 'rehearse',
          entryStatus: 'approved',
          senses: [],
        },
        [qualityGate(bad)],
      ).join(' '),
    ).toMatch(/gate 'quality': fail/);
  });
});

describe('approval never publishes', () => {
  it('is not a state the review workflow can reach', () => {
    // planReviewApply can only produce approved or rejected; publication is a
    // separate command with its own gates.
    const doc = decisions();
    const plan = planReviewApply(doc, [row()]);
    expect(plan.toApply.map((d) => d.toStatus)).toEqual(['approved']);

    const rejecting = decisions();
    rejecting.decisions[0].decision = 'reject';
    rejecting.decisions[0].notes = 'Too broad.';
    expect(planReviewApply(rejecting, [row()]).toApply[0].toStatus).toBe('rejected');
  });
});
