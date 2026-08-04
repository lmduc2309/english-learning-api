import * as fs from 'fs';
import * as path from 'path';
import { RegistrySnapshot } from './lib/registry';
import {
  BORROWED_SOURCES,
  RELATION_TYPES,
  RelationAuditRow,
  RelationsFile,
  auditRelations,
  planRelationImport,
  relationHash,
  validateRelationsFile,
} from './relations';

const SENSE_A = '11111111-1111-1111-1111-111111111111';
const SENSE_B = '22222222-2222-2222-2222-222222222222';
const SENSE_C = '33333333-3333-3333-3333-333333333333';

function registry(overrides: Partial<RegistrySnapshot> = {}): RegistrySnapshot {
  return {
    approvedScopesBySource: { 'dsd-relations-original': ['relation'] },
    contributors: {
      'DSD-A-001': { status: 'active', roles: ['author'], rightsEvidenceId: 'EV-IP-001' },
      'DSD-R-001': { status: 'active', roles: ['linguistic_reviewer'], rightsEvidenceId: 'EV-IP-010' },
    },
    ...overrides,
  };
}

function file(overrides: Partial<RelationsFile> = {}): RelationsFile {
  return {
    relations_version: 1,
    batch_id: 'B-REL-001',
    declaration_id: 'DSD-DECL-20260804-001',
    relations: [
      {
        from_sense_id: SENSE_A,
        to_sense_id: SENSE_B,
        relation_type: 'synonym',
        authored_by: 'DSD-A-001',
        source_id: 'dsd-relations-original',
        rights_evidence_id: 'EV-IP-001',
        rationale: 'Both senses describe practising before a performance.',
      },
    ],
    ...overrides,
  };
}

describe('validateRelationsFile', () => {
  it('accepts a well-formed batch', () => {
    expect(validateRelationsFile(file(), registry())).toEqual([]);
  });

  it('requires a clean-room declaration', () => {
    expect(validateRelationsFile(file({ declaration_id: '' }), registry()).join(' ')).toMatch(
      /declaration_id is required/,
    );
  });

  it('requires DSD sense UUIDs at both ends', () => {
    const bad = file();
    (bad.relations[0] as any).from_sense_id = 'rehearse';
    expect(validateRelationsFile(bad, registry()).join(' ')).toMatch(
      /from_sense_id must be a DSD sense UUID/,
    );
  });

  it('refuses a sense related to itself', () => {
    const bad = file();
    bad.relations[0].to_sense_id = SENSE_A;
    expect(validateRelationsFile(bad, registry()).join(' ')).toMatch(/not related to itself/);
  });

  it.each(BORROWED_SOURCES)('refuses the borrowed relation set %s', (source) => {
    // Importing one would put a borrowed licence back into the corpus DSD was
    // rebuilt to keep clean.
    const bad = file();
    bad.relations[0].source_id = source;
    expect(validateRelationsFile(bad, registry()).join(' ')).toMatch(/authored, not copied/);
  });

  it('refuses a source not approved for the relation scope', () => {
    const bad = file();
    bad.relations[0].source_id = 'dsd-english-original';
    expect(validateRelationsFile(bad, registry()).join(' ')).toMatch(
      /not approved for scope 'relation'/,
    );
  });

  it('refuses an unknown relation type', () => {
    const bad = file();
    (bad.relations[0] as any).relation_type = 'hypernym';
    expect(validateRelationsFile(bad, registry()).join(' ')).toMatch(/relation_type must be one of/);
  });

  it.each(RELATION_TYPES)('accepts the relation type %s', (relationType) => {
    const good = file();
    good.relations[0].relation_type = relationType;
    expect(validateRelationsFile(good, registry())).toEqual([]);
  });

  it('requires a rationale, because a relation is a claim', () => {
    const bad = file();
    bad.relations[0].rationale = '';
    expect(validateRelationsFile(bad, registry()).join(' ')).toMatch(/stands behind/);
  });

  it('refuses an author who does not hold the author role', () => {
    const bad = file();
    bad.relations[0].authored_by = 'DSD-R-001';
    expect(validateRelationsFile(bad, registry()).join(' ')).toMatch(/does not hold the author role/);
  });

  it('refuses rights evidence that disagrees with the registry', () => {
    const bad = file();
    bad.relations[0].rights_evidence_id = 'EV-IP-999';
    expect(validateRelationsFile(bad, registry()).join(' ')).toMatch(/does not match the registry/);
  });

  it.each(['status', 'reviewed_by', 'content_sha256', 'cefr', 'cefr_level', 'frequency_rank', 'word_id'])(
    'refuses the field %s',
    (field) => {
      const bad: any = file();
      bad.relations[0][field] = 'x';
      expect(validateRelationsFile(bad, registry()).join(' ')).toMatch(
        new RegExp(`forbidden field '${field}'`),
      );
    },
  );

  it('treats a symmetric relation stated both ways as a duplicate', () => {
    // The view serves both directions, so recording both would duplicate the
    // claim and let one half be retired without the other.
    const bad = file();
    bad.relations.push({
      ...bad.relations[0],
      from_sense_id: SENSE_B,
      to_sense_id: SENSE_A,
    });
    expect(validateRelationsFile(bad, registry()).join(' ')).toMatch(/duplicates an earlier/);
  });

  it('allows a directional relation in both directions, which are different claims', () => {
    // "X is a derived form of Y" and the reverse are separate assertions.
    const good = file();
    good.relations[0].relation_type = 'derived_form';
    good.relations.push({
      ...good.relations[0],
      from_sense_id: SENSE_B,
      to_sense_id: SENSE_A,
      relation_type: 'derived_form',
    });
    expect(validateRelationsFile(good, registry())).toEqual([]);
  });
});

describe('planRelationImport', () => {
  it('imports a relation whose ends both exist', () => {
    const plan = planRelationImport(file(), [SENSE_A, SENSE_B]);
    expect(plan.blocked).toEqual([]);
    expect(plan.toInsert[0]).toMatchObject({
      fromSenseId: SENSE_A,
      toSenseId: SENSE_B,
      relationType: 'synonym',
      status: 'draft',
    });
  });

  it('imports as a draft, never approved', () => {
    // Approval is a separate act by a different person.
    const plan = planRelationImport(file(), [SENSE_A, SENSE_B]);
    expect(plan.toInsert[0].status).toBe('draft');
    expect(plan.toInsert[0]).not.toHaveProperty('reviewedBy');
  });

  it('refuses a relation to a sense that does not exist', () => {
    // Checked before writing rather than letting the foreign key fail halfway
    // through a batch.
    const plan = planRelationImport(file(), [SENSE_A]);
    expect(plan.toInsert).toEqual([]);
    expect(plan.blocked.join(' ')).toMatch(/do not resolve to a DSD sense/);
    expect(plan.blocked.join(' ')).toContain(SENSE_B);
  });

  it('refuses a relation already recorded, in either direction', () => {
    const existing = [{ fromSenseId: SENSE_B, toSenseId: SENSE_A, relationType: 'synonym' }];
    const plan = planRelationImport(file(), [SENSE_A, SENSE_B], existing);
    expect(plan.blocked.join(' ')).toMatch(/already recorded/);
  });

  it('does not treat a directional relation as recorded from its reverse', () => {
    const doc = file();
    doc.relations[0].relation_type = 'derived_form';
    const existing = [{ fromSenseId: SENSE_B, toSenseId: SENSE_A, relationType: 'derived_form' }];
    expect(planRelationImport(doc, [SENSE_A, SENSE_B], existing).blocked).toEqual([]);
  });

  it('reports every blocked relation rather than the first', () => {
    const doc = file();
    doc.relations.push({ ...doc.relations[0], to_sense_id: SENSE_C, relation_type: 'antonym' });
    const plan = planRelationImport(doc, [SENSE_A]);
    expect(plan.blocked).toHaveLength(2);
  });

  it('hashes the claim, so restating it is idempotent', () => {
    const first = planRelationImport(file(), [SENSE_A, SENSE_B]).toInsert[0].contentSha256;
    const second = planRelationImport(file(), [SENSE_A, SENSE_B]).toInsert[0].contentSha256;
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashes a different claim differently', () => {
    const synonym = relationHash({
      from_sense_id: SENSE_A,
      to_sense_id: SENSE_B,
      relation_type: 'synonym',
    });
    const antonym = relationHash({
      from_sense_id: SENSE_A,
      to_sense_id: SENSE_B,
      relation_type: 'antonym',
    });
    expect(synonym).not.toBe(antonym);
  });
});

describe('auditRelations', () => {
  function row(overrides: Partial<RelationAuditRow> = {}): RelationAuditRow {
    return {
      id: 'r1',
      relationType: 'synonym',
      status: 'published',
      sourceId: 'dsd-relations-original',
      authoredBy: 'DSD-A-001',
      reviewedBy: 'DSD-R-001',
      fromSenseExists: true,
      toSenseExists: true,
      ...overrides,
    };
  }

  it('reports nothing for a clean relation', () => {
    expect(auditRelations([row()])).toEqual([]);
  });

  it('reports a relation referencing a missing sense', () => {
    // The foreign keys make this impossible; if it appears, something is wrong
    // deeper than this table.
    expect(auditRelations([row({ toSenseExists: false })]).join(' ')).toMatch(
      /references a sense that does not exist/,
    );
  });

  it.each(BORROWED_SOURCES)('reports a published relation from %s', (source) => {
    expect(auditRelations([row({ sourceId: source })]).join(' ')).toMatch(
      /is a borrowed relation set/,
    );
  });

  it('reports a published relation with no reviewer', () => {
    expect(auditRelations([row({ reviewedBy: null })]).join(' ')).toMatch(/names no reviewer/);
  });

  it('reports a self-reviewed relation', () => {
    expect(auditRelations([row({ reviewedBy: 'DSD-A-001' })]).join(' ')).toMatch(
      /reviewed by its own author/,
    );
  });

  it('does not require a reviewer on a draft', () => {
    expect(auditRelations([row({ status: 'draft', reviewedBy: null })])).toEqual([]);
  });

  it('reports an unknown relation type', () => {
    expect(auditRelations([row({ relationType: 'hypernym' })]).join(' ')).toMatch(
      /unknown relation type/,
    );
  });
});

describe('what the tool will not do', () => {
  const code = fs
    .readFileSync(path.resolve(__dirname, 'relations.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('writes no review decision', () => {
    // auditRelations reads 'approved' and 'published' to check them, which is
    // the opposite of setting them. What must be absent is any write.
    expect(code).not.toMatch(/UPDATE\s+dsd_relations/);
    expect(code).not.toMatch(/SET\s+status/);
    expect(code).not.toMatch(/reviewed_by\s*=/);
    const inserts = [...code.matchAll(/INSERT INTO (\w+)/g)].map((m) => m[1]);
    expect(inserts.sort()).toEqual(['dsd_provenance_events', 'dsd_relations']);
  });

  it('inserts only drafts', () => {
    expect(code).toMatch(/VALUES \(\$1,\$2,\$3,'draft'/);
  });

  it('opens no legacy connection', () => {
    const modules = [...code.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    for (const module of modules) {
      expect(module).toMatch(/^fs$|^path$|^dotenv$|dsd-corpus|\.\/lib\//);
    }
  });

  it('mentions CEFR and frequency only to forbid them', () => {
    // dsd_band is a product ordering value, and DSD has no CEFR rubric — so
    // these words may appear in the refusal list and nowhere else.
    const forbiddenList = code.match(/const FORBIDDEN_FIELDS = \[[\s\S]*?\]/)![0];
    const elsewhere = code.replace(forbiddenList, '');
    expect(elsewhere).not.toMatch(/\bcefr\b/i);
    expect(elsewhere).not.toMatch(/frequency/i);
    expect(forbiddenList).toContain("'cefr'");
    expect(forbiddenList).toContain("'frequency_rank'");
  });
});
