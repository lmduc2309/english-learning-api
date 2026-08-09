import * as fs from 'fs';
import * as path from 'path';
import {
  ALGORITHM_VERSION,
  NORMALIZATION_VERSION,
  SimilarityPolicy,
  policyHash,
} from './lib/similarity';
import {
  BoundaryProbe,
  DSD_AUDIT_ROLE,
  DsdRecord,
  LEGACY_READER_ROLE,
  StoredResult,
  assertAuditBoundary,
  auditRecord,
  authorReport,
  evaluateSimilarityGate,
  validateDecisionRequest,
} from './similarity-audit';

function policy(): SimilarityPolicy {
  return {
    policyVersion: 'v1',
    normalizationVersion: NORMALIZATION_VERSION,
    algorithmVersion: ALGORITHM_VERSION,
    effectiveDate: '2026-08-03',
    approvers: ['DSD-P-001', 'DSD-R-001', 'DSD-L-001'],
    benchmarkSha256: 'a'.repeat(64),
    rationale: 'Calibrated against the v1 labelled control set.',
    bands: {
      definition: {
        high: { tokenJaccard: 0.8, wordNgramJaccard: 0.6, charNgramJaccard: 0.8, cosine: 0.9, longestRunRatio: 0.7, contentRun: 6 },
        medium: { tokenJaccard: 0.6, wordNgramJaccard: 0.35, charNgramJaccard: 0.6, cosine: 0.75, longestRunRatio: 0.5, contentRun: 4 },
      },
      example: {
        high: { tokenJaccard: 0.85, wordNgramJaccard: 0.65, charNgramJaccard: 0.85, cosine: 0.92, longestRunRatio: 0.75, contentRun: 7 },
        medium: { tokenJaccard: 0.65, wordNgramJaccard: 0.4, charNgramJaccard: 0.65, cosine: 0.8, longestRunRatio: 0.55, contentRun: 5 },
      },
    },
  };
}

function record(overrides: Partial<DsdRecord> = {}): DsdRecord {
  return {
    entityKind: 'sense',
    entityId: 'd1',
    recordType: 'definition',
    contentSha256: 'a'.repeat(64),
    text: 'Someone whose job is to help students learn something new.',
    ...overrides,
  };
}

function probe(overrides: Partial<BoundaryProbe> = {}): BoundaryProbe {
  return { currentUser: LEGACY_READER_ROLE, writePrivileges: [], readableBaseTables: [], ...overrides };
}

const dsdProbe = (overrides: Partial<BoundaryProbe> = {}): BoundaryProbe =>
  probe({ currentUser: DSD_AUDIT_ROLE, ...overrides });

describe('assertAuditBoundary', () => {
  it('accepts two correctly narrowed accounts', () => {
    expect(assertAuditBoundary(probe(), dsdProbe())).toEqual([]);
  });

  it('refuses a legacy connection under a broader account', () => {
    expect(assertAuditBoundary(probe({ currentUser: 'dictionary_user' }), dsdProbe()).join(' '))
      .toMatch(/not dsd_similarity_reader/);
  });

  it('refuses a legacy account that can write', () => {
    // The audit reads. A write privilege means this command could modify the
    // corpus it exists to compare against.
    expect(
      assertAuditBoundary(probe({ writePrivileges: ['public.definitions:UPDATE'] }), dsdProbe()).join(' '),
    ).toMatch(/can write/);
  });

  it('refuses a legacy account that can read a base table', () => {
    // Reading through the view is the licensing boundary: it exposes English
    // only. Base-table access would expose the unlicensed Vietnamese too.
    expect(
      assertAuditBoundary(probe({ readableBaseTables: ['public.definitions'] }), dsdProbe()).join(' '),
    ).toMatch(/must see only dsd_compliance\.english_similarity_input/);
  });

  it('refuses a DSD account that can edit authored content', () => {
    expect(
      assertAuditBoundary(probe(), dsdProbe({ writePrivileges: ['dsd_senses:UPDATE'] })).join(' '),
    ).toMatch(/does not fix findings/);
  });

  it('refuses a DSD connection that is not the auditor', () => {
    expect(assertAuditBoundary(probe(), dsdProbe({ currentUser: 'dsd_curator' })).join(' '))
      .toMatch(/not dsd_auditor/);
  });

  it('reports every breach at once', () => {
    expect(
      assertAuditBoundary(
        probe({ currentUser: 'postgres', writePrivileges: ['x:INSERT'], readableBaseTables: ['y'] }),
        dsdProbe({ currentUser: 'dsd_curator', writePrivileges: ['dsd_senses:UPDATE'] }),
      ),
    ).toHaveLength(5);
  });
});

describe('auditRecord', () => {
  it('classifies independent writing as low and keeps no digest', () => {
    const result = auditRecord(record(), ['A person who teaches children in a school.'], policy());
    expect(result.matchClass).toBe('low');
    expect(result.decision).toBe('clear');
    // Nothing was matched, so there is nothing to record about legacy at all.
    expect(result.legacyDigest).toBeNull();
  });

  it('classifies a verbatim copy as exact and demands a rewrite', () => {
    const copied = record({ text: 'A person who teaches children in a school.' });
    const result = auditRecord(copied, ['A person who teaches children in a school.'], policy());
    expect(result.matchClass).toBe('exact');
    expect(result.decision).toBe('rewrite_required');
  });

  it('keeps the worst match, not the first', () => {
    // 40% similar to many rows and 96% to one is a copying problem; taking the
    // first or the average would hide it.
    const result = auditRecord(
      record({ text: 'A person who teaches children in a school.' }),
      [
        'Something completely unrelated about weather.',
        'Another unrelated sentence about food.',
        'A person who teaches children at a school.',
      ],
      policy(),
    );
    expect(result.matchClass).toBe('high');
  });

  it('records a digest of the matched text, never the text', () => {
    const result = auditRecord(
      record({ text: 'A person who teaches children in a school.' }),
      ['A person who teaches children at a school.'],
      policy(),
    );
    expect(result.legacyDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(result)).not.toContain('at a school');
  });

  it('stamps the versions and policy that produced it', () => {
    const result = auditRecord(record(), ['x'], policy());
    expect(result.normalizationVersion).toBe(NORMALIZATION_VERSION);
    expect(result.algorithmVersion).toBe(ALGORITHM_VERSION);
    expect(result.policySha256).toBe(policyHash(policy()));
  });

  it('handles a record with no candidates at all', () => {
    const result = auditRecord(record(), [], policy());
    expect(result.matchClass).toBe('low');
    expect(result.legacyDigest).toBeNull();
  });

  it('is deterministic', () => {
    const candidates = ['A person who teaches children at a school.', 'Other text.'];
    expect(auditRecord(record(), candidates, policy())).toEqual(
      auditRecord(record(), candidates, policy()),
    );
  });
});

describe('authorReport', () => {
  it('reduces every result to one of three words', () => {
    const results = auditRecord(
      record({ text: 'A person who teaches children in a school.' }),
      ['A person who teaches children in a school.'],
      policy(),
    );
    const report = authorReport([results]);
    expect(report[0].state).toBe('rewrite_required');
    expect(Object.keys(report[0])).toEqual(['entityId', 'state']);
  });

  it('exposes no score and no digest to the author', () => {
    const result = auditRecord(
      record({ text: 'A person who teaches children in a school.' }),
      ['A person who teaches children at a school.'],
      policy(),
    );
    const serialized = JSON.stringify(authorReport([result]));
    expect(serialized).not.toContain(result.legacyDigest!);
    expect(serialized).not.toMatch(/cosine|jaccard|longestRun/i);
  });
});

describe('evaluateSimilarityGate', () => {
  const POLICY_SHA = policyHash(policy());
  const records = [{ entityKind: 'sense', entityId: 'd1', contentSha256: 'a'.repeat(64) }];

  function stored(overrides: Partial<StoredResult> = {}): StoredResult {
    return {
      entityKind: 'sense',
      entityId: 'd1',
      contentSha256: 'a'.repeat(64),
      policySha256: POLICY_SHA,
      matchClass: 'low',
      decision: 'clear',
      ...overrides,
    };
  }

  it('passes when every record has a current, permitting result', () => {
    expect(evaluateSimilarityGate(records, [stored()], POLICY_SHA).status).toBe('pass');
  });

  it('blocks when a record has never been audited', () => {
    expect(evaluateSimilarityGate(records, [], POLICY_SHA)).toMatchObject({ status: 'not_run' });
  });

  it('blocks when the text changed after the audit', () => {
    // The stored verdict describes words that are no longer being published.
    const gate = evaluateSimilarityGate(records, [stored({ contentSha256: 'b'.repeat(64) })], POLICY_SHA);
    expect(gate.status).toBe('not_run');
  });

  it('blocks when the policy changed after the audit', () => {
    const gate = evaluateSimilarityGate(records, [stored({ policySha256: 'c'.repeat(64) })], POLICY_SHA);
    expect(gate.status).toBe('not_run');
  });

  it('blocks an exact match however it was decided', () => {
    for (const decision of ['clear', 'manual_review', 'rewrite_required'] as const) {
      expect(
        evaluateSimilarityGate(records, [stored({ matchClass: 'exact', decision })], POLICY_SHA).status,
      ).toBe('fail');
    }
  });

  it('blocks unresolved high and medium results', () => {
    for (const matchClass of ['high', 'medium'] as const) {
      expect(
        evaluateSimilarityGate(records, [stored({ matchClass, decision: 'manual_review' })], POLICY_SHA).status,
      ).toBe('fail');
    }
  });

  it('passes a high result once cleared as independently authored', () => {
    expect(
      evaluateSimilarityGate(
        records,
        [stored({ matchClass: 'high', decision: 'independently_authored_cleared' })],
        POLICY_SHA,
      ).status,
    ).toBe('pass');
  });

  it('names what blocked it', () => {
    const gate = evaluateSimilarityGate(records, [stored({ matchClass: 'high', decision: 'manual_review' })], POLICY_SHA);
    expect(gate.detail).toMatch(/d1 is high\/manual_review/);
  });
});

/** Prose explains the boundary; only code can breach it. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('the legacy boundary in the source', () => {
  const code = stripComments(fs.readFileSync(path.resolve(__dirname, 'similarity-audit.ts'), 'utf8'));

  it('reads legacy only through the restricted English view', () => {
    const froms = [...code.matchAll(/FROM\s+([A-Za-z_.]+)/g)].map((m) => m[1].toLowerCase());
    expect(froms.length).toBeGreaterThan(0);
    for (const from of froms) {
      expect(from).toMatch(/^dsd_|^dsd_compliance\.|^information_schema\.|^pg_class$/);
    }
    expect(code).toContain('dsd_compliance.english_similarity_input');
  });

  it('never writes to legacy', () => {
    // Every mutating statement in the file must target DSD.
    const mutations = [...code.matchAll(/(INSERT INTO|UPDATE|DELETE FROM)\s+([a-z_."]+)/gi)];
    expect(mutations.length).toBeGreaterThan(0);
    for (const [, , target] of mutations) {
      expect(target.replace(/"/g, '')).toMatch(/^dsd_/);
    }
  });

  it('reads no Vietnamese from legacy', () => {
    // The tudien Vietnamese has no licence; it is not compared, not digested,
    // not read.
    expect(code).not.toMatch(/vietnamese|example_vi|definition_vi|meaning_vi/i);
  });
});

describe('authoring commands stay away from legacy', () => {
  const AUTHORING = ['inventory.ts', 'curation.ts', 'review.ts', 'quality-audit.ts'];

  it.each(AUTHORING)('%s imports no legacy connector', (file) => {
    const source = fs.readFileSync(path.resolve(__dirname, file), 'utf8');
    const modules = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    for (const module of modules) {
      expect(module).not.toMatch(/app\.datasource|\/data-source|typeorm\.config|ormconfig/);
    }
  });

  it.each(AUTHORING)('%s never reads the legacy audit view or its URL', (file) => {
    const source = fs.readFileSync(path.resolve(__dirname, file), 'utf8');
    expect(source).not.toContain('LEGACY_AUDIT_DATABASE_URL');
    expect(source).not.toContain('english_similarity_input');
  });

  it('leaves the audit as the only content command opening a raw pg client', () => {
    // Every other content command goes through createDsdDataSource, which
    // resolves a DSD role URL and cannot reach legacy. The backup and restore
    // tools use pg too, but they move whole databases and never read content.
    const contentCommands = [...AUTHORING, 'similarity-audit.ts'];
    const offenders = contentCommands.filter((f) =>
      /from 'pg'/.test(fs.readFileSync(path.resolve(__dirname, f), 'utf8')),
    );
    expect(offenders).toEqual(['similarity-audit.ts']);
  });
});

describe('manual compliance decisions', () => {
  const valid = () => ({
    entityId: '11111111-1111-1111-1111-111111111111',
    decision: 'independently_authored_cleared',
    reviewer: 'DSD-C-001',
    reason: 'independent_process_evidence',
    evidenceId: 'EV-COMPLIANCE-001',
    contributor: {
      status: 'active',
      roles: ['compliance_reviewer'],
      rightsEvidenceId: 'EV-IP-020',
    },
  });

  it('accepts a controlled decision bound to external evidence', () => {
    expect(validateDecisionRequest(valid())).toEqual([]);
  });

  it('refuses an unregistered reviewer or one without the compliance role', () => {
    expect(validateDecisionRequest({ ...valid(), contributor: undefined }).join(' ')).toMatch(
      /not active/,
    );
    expect(
      validateDecisionRequest({
        ...valid(),
        contributor: { status: 'active', roles: ['author'], rightsEvidenceId: 'EV-IP-1' },
      }).join(' '),
    ).toMatch(/does not have the compliance_reviewer role/);
  });

  it('allows only controlled reasons so legacy wording cannot enter the DSD row', () => {
    expect(
      validateDecisionRequest({ ...valid(), reason: 'Looks close to the legacy definition' }).join(
        ' ',
      ),
    ).toMatch(/reason.*must be/);
  });
});
