import * as fs from 'fs';
import * as path from 'path';
import {
  FORBIDDEN_PACKAGE_FIELDS,
  CurationPackage,
  RegistrySnapshot,
  validatePackage,
  planCurationImport,
} from './curation';

const ENTRY_ID = '11111111-1111-1111-1111-111111111111';

/** A registry where DSD's own sources and one contributor pair are approved. */
function registry(overrides: Partial<RegistrySnapshot> = {}): RegistrySnapshot {
  return {
    approvedScopesBySource: {
      'dsd-english-original': ['definition', 'example'],
      'dsd-vietnamese-original': ['translation', 'example'],
    },
    contributors: {
      'DSD-A-001': { status: 'active', roles: ['author'], rightsEvidenceId: 'EV-IP-001' },
      'DSD-A-002': { status: 'active', roles: ['author'], rightsEvidenceId: 'EV-IP-002' },
    },
    ...overrides,
  };
}

function pkg(overrides: Partial<CurationPackage> = {}): CurationPackage {
  return {
    package_version: 1,
    batch_id: 'B-001',
    declaration_id: 'DSD-DECL-20260802-001',
    entries: [
      {
        dsd_entry_id: ENTRY_ID,
        senses: [
          {
            sense_key: 'k1',
            sense_order: 1,
            part_of_speech: 'verb',
            definition_en: 'To practise something before performing it.',
            usage_labels: ['general'],
            authored_by: 'DSD-A-001',
            source_id: 'dsd-english-original',
            rights_evidence_id: 'EV-IP-001',
            translation: {
              locale: 'vi',
              text: 'diễn tập',
              authored_by: 'DSD-A-002',
              source_id: 'dsd-vietnamese-original',
              rights_evidence_id: 'EV-IP-002',
            },
            examples: [
              {
                example_order: 1,
                en: 'They rehearse every Thursday.',
                vi: 'Họ diễn tập vào mỗi thứ Năm.',
                authored_by: 'DSD-A-002',
                source_id: 'dsd-vietnamese-original',
                rights_evidence_id: 'EV-IP-002',
              },
            ],
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('validatePackage — structure', () => {
  it('accepts a well-formed package', () => {
    expect(validatePackage(pkg(), registry())).toEqual([]);
  });

  it('requires a clean-room declaration for the batch', () => {
    expect(validatePackage(pkg({ declaration_id: '' }), registry()).join(' ')).toMatch(
      /declaration/i,
    );
  });

  it('requires a DSD entry UUID, not a headword', () => {
    const bad = pkg();
    bad.entries[0].dsd_entry_id = 'rehearse';
    expect(validatePackage(bad, registry()).join(' ')).toMatch(/uuid/i);
  });

  it('requires at least one sense', () => {
    const bad = pkg();
    bad.entries[0].senses = [];
    expect(validatePackage(bad, registry()).join(' ')).toMatch(/at least one sense/i);
  });

  it('requires a Vietnamese translation and at least one example per sense', () => {
    const noTranslation = pkg();
    delete (noTranslation.entries[0].senses[0] as any).translation;
    expect(validatePackage(noTranslation, registry()).join(' ')).toMatch(/translation/i);

    const noExample = pkg();
    noExample.entries[0].senses[0].examples = [];
    expect(validatePackage(noExample, registry()).join(' ')).toMatch(/example/i);
  });
});

describe('validatePackage — fields this package must never carry', () => {
  it.each(FORBIDDEN_PACKAGE_FIELDS)('rejects %s anywhere in the package', (field) => {
    const bad: any = pkg();
    bad.entries[0].senses[0][field] = 'anything';
    expect(validatePackage(bad, registry()).join(' ')).toMatch(
      new RegExp(`forbidden field '${field}'`, 'i'),
    );
  });

  it('rejects IPA and audio, which are separate workflows', () => {
    for (const field of ['ipa', 'audio_url']) {
      const bad: any = pkg();
      bad.entries[0].senses[0][field] = 'x';
      expect(validatePackage(bad, registry()).join(' ')).toMatch(/forbidden field/i);
    }
  });

  it('rejects reviewer and publication fields, which curation cannot set', () => {
    for (const field of ['reviewed_by', 'reviewed_at', 'status']) {
      const bad: any = pkg();
      bad.entries[0].senses[0][field] = 'x';
      expect(validatePackage(bad, registry()).join(' ')).toMatch(/forbidden field/i);
    }
  });

  it('rejects external provider and model fields, barred in DSD v1', () => {
    for (const field of ['provider', 'model', 'prompt']) {
      const bad: any = pkg();
      bad.entries[0].senses[0][field] = 'x';
      expect(validatePackage(bad, registry()).join(' ')).toMatch(/forbidden field/i);
    }
  });
});

describe('validatePackage — source scope', () => {
  it('rejects a source not approved for the record scope', () => {
    // English source used for a translation: approved, but not for that scope.
    const bad = pkg();
    bad.entries[0].senses[0].translation!.source_id = 'dsd-english-original';
    expect(validatePackage(bad, registry()).join(' ')).toMatch(
      /not approved for scope 'translation'/i,
    );
  });

  it('rejects a source that is blocked outright', () => {
    const bad = pkg();
    bad.entries[0].senses[0].source_id = 'oewn-2025';
    expect(validatePackage(bad, registry()).join(' ')).toMatch(/not approved/i);
  });

  it('rejects everything when no source is approved yet', () => {
    // The real registry today: every source blocked pending IP evidence.
    const errors = validatePackage(pkg(), registry({ approvedScopesBySource: {} }));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join(' ')).toMatch(/not approved/i);
  });
});

describe('validatePackage — contributor rights', () => {
  it('rejects an unknown contributor', () => {
    const bad = pkg();
    bad.entries[0].senses[0].authored_by = 'DSD-A-999';
    expect(validatePackage(bad, registry()).join(' ')).toMatch(/not in the contributor registry/i);
  });

  it.each(['inactive', 'revoked', 'expired'])('rejects a %s contributor', (status) => {
    const reg = registry();
    reg.contributors['DSD-A-001'].status = status;
    expect(validatePackage(pkg(), reg).join(' ')).toMatch(/not active/i);
  });

  it('rejects a contributor with no rights evidence', () => {
    const reg = registry();
    reg.contributors['DSD-A-001'].rightsEvidenceId = '';
    expect(validatePackage(pkg(), reg).join(' ')).toMatch(/rights evidence/i);
  });

  it('rejects a rights evidence ID that disagrees with the registry', () => {
    // A package asserting evidence the registry does not record is a forgery
    // risk, not a typo to tolerate.
    const bad = pkg();
    bad.entries[0].senses[0].rights_evidence_id = 'EV-IP-999';
    expect(validatePackage(bad, registry()).join(' ')).toMatch(/does not match the registry/i);
  });

  it('rejects a contributor lacking the author role', () => {
    const reg = registry();
    reg.contributors['DSD-A-001'].roles = ['reviewer'];
    expect(validatePackage(pkg(), reg).join(' ')).toMatch(/author role/i);
  });
});

describe('planCurationImport — draft only', () => {
  it('produces draft rows with hashes and no reviewer or publication state', () => {
    const plan = planCurationImport(pkg());
    expect(plan.senses).toHaveLength(1);

    const sense = plan.senses[0];
    expect(sense.status).toBe('draft');
    expect(sense.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    // The importer must be structurally incapable of these.
    expect(sense).not.toHaveProperty('reviewedBy');
    expect(sense).not.toHaveProperty('reviewedAt');

    expect(plan.translations[0].status).toBe('draft');
    expect(plan.examples[0].status).toBe('draft');
    expect(plan.translations[0].contentSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(plan.examples[0].contentSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('gives each record its own author and evidence', () => {
    const plan = planCurationImport(pkg());
    expect(plan.senses[0].authoredBy).toBe('DSD-A-001');
    expect(plan.translations[0].authoredBy).toBe('DSD-A-002');
    expect(plan.examples[0].authoredBy).toBe('DSD-A-002');
  });

  it('produces identical hashes for identical content, so re-import is detectable', () => {
    expect(planCurationImport(pkg()).senses[0].contentSha256).toBe(
      planCurationImport(pkg()).senses[0].contentSha256,
    );
  });
});

describe('the committed template', () => {
  it('is a blank template carrying no content', () => {
    const template = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, '../../data/dsd/curation/curation-template.json'),
        'utf8',
      ),
    );
    const text = JSON.stringify(template);
    // A template with an example definition in it is a template that gets
    // copied, and then nobody authored anything.
    for (const field of FORBIDDEN_PACKAGE_FIELDS) {
      expect(text).not.toContain(`"${field}"`);
    }
    const sense = template.entries[0].senses[0];
    expect(sense.definition_en).toBe('');
    expect(sense.translation.text).toBe('');
    expect(sense.examples[0].en).toBe('');
    expect(sense.examples[0].vi).toBe('');
  });
});
