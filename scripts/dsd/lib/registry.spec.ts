import {
  DSD_SOURCE_SCOPES,
  PERSONAL_DATA_FIELDS,
  validateSourceRegistry,
  validateToolRegistry,
  validateContributorRegistry,
  loadRegistries,
} from './registry';

function source(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dsd-english-original',
    aliases: ['DSD English original content'],
    scopes: ['definition'],
    status: 'blocked',
    blockedReason: 'IP-assignment evidence not yet recorded',
    approvedScopes: [],
    evidenceIds: [],
    ...overrides,
  };
}

function tool(overrides: Record<string, unknown> = {}) {
  return {
    id: 'misaki',
    aliases: ['Misaki G2P'],
    scopes: ['tool'],
    status: 'candidate',
    url: 'https://github.com/hexgrad/misaki',
    revision: '0f1a2b3c4d5e6f70819293a4b5c6d7e8f9012345',
    sha256: 'a'.repeat(64),
    evidenceIds: ['EV-TOOL-MISAKI-001'],
    ...overrides,
  };
}

function contributor(overrides: Record<string, unknown> = {}) {
  return {
    id: 'DSD-C-001',
    roles: ['author'],
    languages: ['en', 'vi'],
    engagementType: 'contractor',
    startDate: '2026-08-09',
    permissions: ['author_definition'],
    ipAssignmentEvidenceId: 'EV-IP-001',
    status: 'active',
    ...overrides,
  };
}

describe('validateSourceRegistry', () => {
  it('accepts a well-formed blocked source', () => {
    expect(validateSourceRegistry({ version: 1, sources: [source()] })).toEqual([]);
  });

  it('rejects a duplicate alias across two sources', () => {
    const errors = validateSourceRegistry({
      version: 1,
      sources: [
        source(),
        source({ id: 'other', aliases: ['DSD English original content'] }),
      ],
    });
    expect(errors.join(' ')).toMatch(/duplicate alias/i);
  });

  it('treats aliases case-insensitively, so casing cannot smuggle a duplicate', () => {
    const errors = validateSourceRegistry({
      version: 1,
      sources: [source(), source({ id: 'other', aliases: ['dsd english ORIGINAL content'] })],
    });
    expect(errors.join(' ')).toMatch(/duplicate alias/i);
  });

  it('rejects an unknown scope', () => {
    const errors = validateSourceRegistry({
      version: 1,
      sources: [source({ scopes: ['definition', 'karaoke'] })],
    });
    expect(errors.join(' ')).toMatch(/unknown scope 'karaoke'/i);
  });

  it('rejects an approved source with no approved scope', () => {
    const errors = validateSourceRegistry({
      version: 1,
      sources: [source({ status: 'approved', approvedScopes: [], evidenceIds: ['EV-1'] })],
    });
    expect(errors.join(' ')).toMatch(/approved .* no approved scope/i);
  });

  it('rejects an approved scope that is not among the declared scopes', () => {
    const errors = validateSourceRegistry({
      version: 1,
      sources: [
        source({
          status: 'approved',
          scopes: ['definition'],
          approvedScopes: ['audio_model'],
          evidenceIds: ['EV-1'],
        }),
      ],
    });
    expect(errors.join(' ')).toMatch(/approved scope 'audio_model'.*not declared/i);
  });

  it('rejects an approved source with no evidence', () => {
    const errors = validateSourceRegistry({
      version: 1,
      sources: [
        source({ status: 'approved', approvedScopes: ['definition'], evidenceIds: [] }),
      ],
    });
    expect(errors.join(' ')).toMatch(/no evidence/i);
  });

  it('rejects a mutable URL with no revision', () => {
    const errors = validateSourceRegistry({
      version: 1,
      sources: [source({ url: 'https://example.com/data.json' })],
    });
    expect(errors.join(' ')).toMatch(/url .* revision/i);
  });

  it('accepts a URL that carries a revision', () => {
    expect(
      validateSourceRegistry({
        version: 1,
        sources: [
          source({
            url: 'https://example.com/data.json',
            revision: 'b'.repeat(40),
          }),
        ],
      }),
    ).toEqual([]);
  });

  it('requires a reason on a blocked source, so blocks are auditable', () => {
    const errors = validateSourceRegistry({
      version: 1,
      sources: [source({ blockedReason: '' })],
    });
    expect(errors.join(' ')).toMatch(/blocked .* reason/i);
  });

  it('rejects a blocked source that also declares approved scopes', () => {
    const errors = validateSourceRegistry({
      version: 1,
      sources: [source({ approvedScopes: ['definition'] })],
    });
    expect(errors.join(' ')).toMatch(/blocked .* approved scope/i);
  });
});

describe('validateToolRegistry', () => {
  it('accepts a pinned candidate tool', () => {
    expect(validateToolRegistry({ version: 1, tools: [tool()] })).toEqual([]);
  });

  it('rejects a tool with no revision pin', () => {
    const errors = validateToolRegistry({
      version: 1,
      tools: [tool({ revision: undefined })],
    });
    expect(errors.join(' ')).toMatch(/revision/i);
  });

  it('rejects a placeholder revision that only looks pinned', () => {
    const errors = validateToolRegistry({
      version: 1,
      tools: [tool({ revision: 'PENDING-PIN-AT-TASK-9' })],
    });
    expect(errors.join(' ')).toMatch(/placeholder revision/i);
  });

  it('rejects a malformed sha256', () => {
    const errors = validateToolRegistry({
      version: 1,
      tools: [tool({ sha256: 'not-a-digest' })],
    });
    expect(errors.join(' ')).toMatch(/sha256/i);
  });

  it('rejects a tool promoted to approved without evidence', () => {
    const errors = validateToolRegistry({
      version: 1,
      tools: [tool({ status: 'approved', evidenceIds: [] })],
    });
    expect(errors.join(' ')).toMatch(/no evidence/i);
  });
});

describe('validateContributorRegistry', () => {
  it('accepts a pseudonymous contributor record', () => {
    expect(
      validateContributorRegistry({ version: 1, contributors: [contributor()] }),
    ).toEqual([]);
  });

  it.each(PERSONAL_DATA_FIELDS)(
    'rejects the personal-data field %s so it cannot reach Git',
    (field) => {
      const errors = validateContributorRegistry({
        version: 1,
        contributors: [contributor({ [field]: 'anything' })],
      });
      expect(errors.join(' ')).toMatch(new RegExp(`personal data.*${field}`, 'i'));
    },
  );

  it('rejects an id that does not look pseudonymous', () => {
    const errors = validateContributorRegistry({
      version: 1,
      contributors: [contributor({ id: 'duc-le-minh' })],
    });
    expect(errors.join(' ')).toMatch(/pseudonymous/i);
  });

  it('rejects an active contributor with no IP-assignment evidence', () => {
    const errors = validateContributorRegistry({
      version: 1,
      contributors: [contributor({ ipAssignmentEvidenceId: '' })],
    });
    expect(errors.join(' ')).toMatch(/ip-assignment evidence/i);
  });

  it('accepts an AI generator with output-rights evidence', () => {
    expect(validateContributorRegistry({
      version: 1,
      contributors: [contributor({
        id: 'DSD-G-001',
        actorType: 'ai',
        roles: ['generator'],
        engagementType: 'automation',
        ipAssignmentEvidenceId: undefined,
        outputRightsEvidenceId: 'EV-OPENAI-OUTPUT-TERMS-20260101',
      })],
    })).toEqual([]);
  });

  it('never lets an AI actor approve content', () => {
    const errors = validateContributorRegistry({
      version: 1,
      contributors: [contributor({
        id: 'DSD-G-001',
        actorType: 'ai',
        roles: ['generator', 'reviewer'],
        engagementType: 'automation',
        ipAssignmentEvidenceId: undefined,
        outputRightsEvidenceId: 'EV-OPENAI-OUTPUT-TERMS-20260101',
      })],
    });
    expect(errors.join(' ')).toMatch(/cannot hold a reviewer role/i);
  });

  it.each([
    ['languages', []],
    ['engagementType', 'informal-helper'],
    ['startDate', 'soon'],
    ['status', 'pending'],
    ['roles', []],
  ])('rejects an incomplete governance field %s', (field, value) => {
    const errors = validateContributorRegistry({
      version: 1,
      contributors: [contributor({ [field]: value })],
    });
    expect(errors).not.toEqual([]);
  });

  it('rejects an unknown role', () => {
    const errors = validateContributorRegistry({
      version: 1,
      contributors: [contributor({ roles: ['author', 'publisher'] })],
    });
    expect(errors.join(' ')).toMatch(/unknown role 'publisher'/i);
  });

  it('rejects duplicate contributor ids', () => {
    const errors = validateContributorRegistry({
      version: 1,
      contributors: [contributor(), contributor()],
    });
    expect(errors.join(' ')).toMatch(/duplicate contributor id/i);
  });
});

describe('the committed registries', () => {
  it('all validate', () => {
    const { errors } = loadRegistries();
    expect(errors).toEqual([]);
  });

  it('keep every blocked source blocked', () => {
    const { sources } = loadRegistries();
    // These are the sources the plan requires stay out of DSD. A future edit
    // that quietly approves one should fail here rather than at release audit.
    for (const alias of ['oewn', 'ngsl', 'wiktionary', 'tudien', 'amy', 'ryan', 'lessac', 'legacy']) {
      const match = sources.find((s) =>
        [s.id, ...(s.aliases || [])].some((a) => a.toLowerCase().includes(alias)),
      );
      expect(match).toBeDefined();
      expect(match!.status).toBe('blocked');
    }
  });

  it('keeps DSD original content blocked until IP evidence exists', () => {
    const { sources } = loadRegistries();
    const dsd = sources.find((s) => s.id === 'dsd-english-original');
    expect(dsd).toBeDefined();
    if (dsd!.evidenceIds.length === 0) {
      expect(dsd!.status).toBe('blocked');
    }
  });

  it('declares every scope the plan defines', () => {
    expect(DSD_SOURCE_SCOPES).toEqual([
      'inventory',
      'definition',
      'translation',
      'example',
      'pronunciation',
      'relation',
      'audio_model',
      'audio_training_data',
      'tool',
    ]);
  });
});
