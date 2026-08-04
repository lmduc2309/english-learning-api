import { AddDsdRelations1785629200000 } from './1785629200000-AddDsdRelations';
import { DSD_ENTITIES } from '../dsd-corpus.datasource';

async function sqlOf(direction: 'up' | 'down'): Promise<string> {
  const query = jest.fn().mockResolvedValue(undefined);
  await new AddDsdRelations1785629200000()[direction]({ query } as any);
  return query.mock.calls.map(([s]) => String(s)).join('\n');
}

/**
 * One constraint's text, sliced to the next CONSTRAINT.
 *
 * A non-greedy match on `))` stops inside `length(btrim("x"))`, which silently
 * truncates the body and makes assertions pass or fail for the wrong reason.
 */
function constraintText(sql: string, name: string): string {
  const start = sql.indexOf(name);
  expect(start).toBeGreaterThan(-1);
  const rest = sql.slice(start);
  const next = rest.indexOf('CONSTRAINT "', name.length);
  return next === -1 ? rest : rest.slice(0, next);
}

/** Relation sets that must not be imported, whatever their licence permits. */
const BORROWED_SOURCES = [
  'oewn-2025',
  'wordnet',
  'open-english-wordnet',
  'wiktionary-en',
  'legacy-dictionary-corpus',
  'tudien-archive',
];

describe('both ends are DSD senses', () => {
  it('references dsd_senses and nothing else', async () => {
    const sql = await sqlOf('up');
    const targets = [...sql.matchAll(/REFERENCES\s+"([a-z_]+)"/g)].map((m) => m[1]);
    expect(targets).toEqual(['dsd_senses', 'dsd_senses']);
  });

  it('has no column that could hold a legacy identifier', async () => {
    const sql = await sqlOf('up');
    for (const forbidden of [
      'word_id', 'definition_id', 'legacy_id', 'synonym_id', 'oewn_sense_id',
    ]) {
      expect(sql).not.toMatch(new RegExp(`"${forbidden}"`));
    }
  });

  it('refuses a sense related to itself', async () => {
    const sql = await sqlOf('up');
    expect(sql).toMatch(/CHK_dsd_relation_not_self.*CHECK \("from_sense_id" <> "to_sense_id"\)/);
  });

  it('refuses a duplicate pair of the same type', async () => {
    expect(await sqlOf('up')).toMatch(
      /UQ_dsd_relation_pair" UNIQUE \("from_sense_id", "to_sense_id", "relation_type"\)/,
    );
  });
});

describe('relation sets are not borrowed', () => {
  it.each(BORROWED_SOURCES)('names %s as a forbidden source', async (source) => {
    // A borrowed relation set would carry the borrowed licence, which is the
    // position the DSD corpus exists to avoid. Named in the schema so the
    // refusal survives an edit to the import tool.
    const sql = await sqlOf('up');
    const check = constraintText(sql, 'CHK_dsd_relation_source_not_borrowed');
    expect(check).toContain(`'${source}'`);
  });

  it('states the rule as a NOT IN, so anything unlisted is allowed', async () => {
    // DSD's own sources are not enumerated here; only the refusals are.
    expect(await sqlOf('up')).toMatch(/"source_id" NOT IN \(/);
  });
});

describe('every relation is reviewed', () => {
  it('requires a reviewer and a timestamp to approve or publish', async () => {
    const sql = await sqlOf('up');
    const check = constraintText(sql, 'CHK_dsd_relation_reviewed');
    expect(check).toMatch(/'approved','published'/);
    expect(check).toMatch(/"reviewed_by" IS NOT NULL/);
    expect(check).toMatch(/"reviewed_at" IS NOT NULL/);
  });

  it('refuses self-review', async () => {
    expect(await sqlOf('up')).toMatch(/"reviewed_by" IS NULL OR "reviewed_by" <> "authored_by"/);
  });

  it('requires an author, a source and rights evidence', async () => {
    const sql = await sqlOf('up');
    const check = constraintText(sql, 'CHK_dsd_relation_attribution');
    for (const column of ['authored_by', 'source_id', 'rights_evidence_id']) {
      expect(check).toContain(`"${column}"`);
    }
  });
});

describe('no CEFR anywhere', () => {
  it('refuses a band spelled like a CEFR level', async () => {
    // DSD has no CEFR rubric, so a band called A2 would be read as a CEFR claim
    // it cannot support.
    const sql = await sqlOf('up');
    expect(sql).toMatch(/CHK_dsd_entry_band_is_not_cefr/);
    expect(sql).toMatch(/!~\* '\^\(a1\|a2\|b1\|b2\|c1\|c2\)\$'/);
  });

  it('adds no CEFR or frequency column of its own', async () => {
    const sql = await sqlOf('up');
    for (const forbidden of ['cefr', 'cefr_level', 'frequency_rank', 'difficulty']) {
      expect(sql).not.toMatch(new RegExp(`"${forbidden}"`, 'i'));
    }
  });
});

describe('the serving view', () => {
  it('exposes published relations between published senses and entries', async () => {
    const view = (await sqlOf('up')).match(/CREATE VIEW "dsd_serving_relations"[\s\S]*?see_also'\)/)![0];
    expect(view).toMatch(/r\."status" = 'published'/);
    expect(view).toMatch(/fs\."status" = 'published' AND ts\."status" = 'published'/);
    expect(view).toMatch(/fe\."status" = 'published' AND te\."status" = 'published'/);
  });

  it('serves symmetric relations both ways, so none is half a pair', async () => {
    const view = (await sqlOf('up')).match(/CREATE VIEW "dsd_serving_relations"[\s\S]*?see_also'\)/)![0];
    expect(view).toMatch(/UNION ALL/);
    expect(view).toMatch(/'synonym','antonym','related','see_also'/);
  });

  it('does not reverse a directional relation', async () => {
    // A derived form of X is not the same statement as X being derived from it.
    const view = (await sqlOf('up')).match(/CREATE VIEW "dsd_serving_relations"[\s\S]*?see_also'\)/)![0];
    const reversed = view.slice(view.indexOf('UNION ALL'));
    expect(reversed).not.toContain("'derived_form'");
  });

  it('exposes no contributor identity or review state', async () => {
    const view = (await sqlOf('up')).match(/CREATE VIEW "dsd_serving_relations"[\s\S]*?see_also'\)/)![0];
    const selected = view.slice(0, view.indexOf('FROM'));
    for (const forbidden of [
      'authored_by', 'reviewed_by', 'source_id', 'batch_id', 'content_sha256',
      'rights_evidence_id',
    ]) {
      expect(selected).not.toContain(forbidden);
    }
  });
});

describe('grants', () => {
  it('gives the serving role the view and never the table', async () => {
    const sql = await sqlOf('up');
    expect(sql).toMatch(/GRANT SELECT ON "dsd_serving_relations" TO dsd_app/);
    expect(sql).not.toMatch(/ON "dsd_relations" TO dsd_app/);
  });

  it('lets the curator author and the auditor read', async () => {
    const sql = await sqlOf('up');
    expect(sql).toMatch(/GRANT SELECT, INSERT, UPDATE ON "dsd_relations" TO dsd_curator/);
    expect(sql).toMatch(/GRANT SELECT ON "dsd_relations" TO dsd_auditor/);
  });

  it('grants the curator no delete', async () => {
    expect(await sqlOf('up')).not.toMatch(/DELETE ON "dsd_relations"/);
  });
});

describe('registration', () => {
  it('registers the entity', () => {
    const names = (DSD_ENTITIES as Array<new () => unknown>).map((e) => e.name);
    expect(names).toContain('DsdRelation');
  });
});

describe('down', () => {
  it('drops the view, the table and the band constraint', async () => {
    const sql = await sqlOf('down');
    expect(sql).toMatch(/DROP VIEW IF EXISTS "dsd_serving_relations"/);
    expect(sql).toMatch(/DROP TABLE IF EXISTS "dsd_relations"/);
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS "CHK_dsd_entry_band_is_not_cefr"/);
  });

  it('drops the view before the table it depends on', async () => {
    const sql = await sqlOf('down');
    expect(sql.indexOf('DROP VIEW')).toBeLessThan(sql.indexOf('DROP TABLE'));
  });
});
