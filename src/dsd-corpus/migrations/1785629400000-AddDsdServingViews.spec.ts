import { AddDsdServingViews1785629400000 } from './1785629400000-AddDsdServingViews';

async function sqlOf(direction: 'up' | 'down'): Promise<string> {
  const query = jest.fn().mockResolvedValue(undefined);
  await new AddDsdServingViews1785629400000()[direction]({ query } as any);
  return query.mock.calls.map(([s]) => String(s)).join('\n');
}

/** SQL with -- comments removed. Prose explains the rules; only SQL applies them. */
async function codeOf(direction: 'up' | 'down'): Promise<string> {
  return (await sqlOf(direction)).replace(/^\s*--.*$/gm, '');
}

const SERVING_VIEWS = [
  'dsd_serving_entries',
  'dsd_serving_senses',
  'dsd_serving_translations',
  'dsd_serving_examples',
  'dsd_serving_pronunciations',
];

const BASE_TABLES = [
  'dsd_entries',
  'dsd_senses',
  'dsd_translations',
  'dsd_examples',
  'dsd_pronunciations',
  'dsd_provenance_events',
  'dsd_similarity_results',
  'dsd_ipa_candidates',
  'dsd_audio_assets',
];

/** Columns that must not appear in any serving view. */
const FORBIDDEN_COLUMNS = [
  'authored_by', 'reviewed_by', 'reviewed_at', 'decided_by', 'generator_actor',
  'rights_evidence_id', 'evidence_id', 'decision_evidence_id',
  'batch_id', 'content_sha256', 'source_id',
  'similarity', 'match_class', 'component_scores', 'legacy_digest',
  'candidate_ipa', 'tool_id', 'qa_findings', 'review_notes',
];

describe('the views expose published content only', () => {
  it('creates every serving view', async () => {
    const sql = await sqlOf('up');
    for (const view of SERVING_VIEWS) {
      expect(sql).toMatch(new RegExp(`CREATE VIEW "${view}"`));
    }
  });

  it('filters every view on published status, entry included', async () => {
    const sql = await sqlOf('up');
    for (const view of SERVING_VIEWS) {
      const definition = sql.match(new RegExp(`CREATE VIEW "${view}" AS[\\s\\S]*?(?=CREATE VIEW|DO \\$\\$|$)`))![0];
      expect(definition).toMatch(/'published'/);
      if (view !== 'dsd_serving_entries') {
        // A published sense under a draft entry must not leak. Every child view
        // joins up to the entry and checks it too.
        expect(definition).toMatch(/e\."status" = 'published'/);
      }
    }
  });

  it.each(FORBIDDEN_COLUMNS)('exposes no %s column', async (column) => {
    const code = await codeOf('up');
    const views = code.slice(0, code.indexOf('DO $$'));
    expect(views).not.toMatch(new RegExp(`"${column}"`));
  });

  it('does not redefine servable audio', async () => {
    // One definition of "servable audio" is enough; the audio migration owns it.
    expect(await sqlOf('up')).not.toMatch(/CREATE VIEW "dsd_servable_audio"/);
  });

  it('exposes a cache validator without reaching the provenance ledger', async () => {
    const code = await codeOf('up');
    expect(code).toMatch(/e\."updated_at"/);
    // The ledger is named in a comment explaining why; it is never selected.
    const views = code.slice(0, code.indexOf('DO $$'));
    expect(views).not.toMatch(/dsd_provenance_events/);
  });
});

describe('the revocation is the load-bearing half', () => {
  it('revokes the serving role from every base table', async () => {
    const sql = await sqlOf('up');
    // The whole DO block, so the ARRAY of table names is inside it.
    const block = sql.match(/DO \$\$[\s\S]*?REVOKE ALL ON[\s\S]*?END \$\$;/)![0];
    expect(block).toMatch(/REVOKE ALL ON %I FROM dsd_app/);
    for (const table of BASE_TABLES) {
      expect(block).toContain(`'${table}'`);
    }
  });

  it('grants the serving role the views instead', async () => {
    const sql = await sqlOf('up');
    for (const view of SERVING_VIEWS) {
      expect(sql).toMatch(new RegExp(`GRANT SELECT ON "${view}" TO dsd_app`));
    }
  });

  it('grants the serving role no view onto candidates or compliance data', async () => {
    const sql = await sqlOf('up');
    expect(sql).not.toMatch(/dsd_ipa_candidates" TO dsd_app/);
    expect(sql).not.toMatch(/dsd_similarity_results" TO dsd_app/);
    expect(sql).not.toMatch(/dsd_provenance_events" TO dsd_app/);
  });

  it('leaves the auditor able to see the base tables', async () => {
    // An audit restricted to the published surface could not tell you what is
    // wrong with the rest.
    const sql = await sqlOf('up');
    expect(sql).not.toMatch(/REVOKE[^;]*dsd_auditor/);
  });

  it('tolerates a database where the roles do not exist', async () => {
    // The same migration runs against a throwaway verification database.
    const sql = await sqlOf('up');
    expect(sql).toMatch(/IF NOT EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'dsd_app'\)/);
    expect(sql).toMatch(/IF EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'dsd_app'\)/);
  });

  it('tolerates a database where a later table does not exist yet', async () => {
    expect(await sqlOf('up')).toMatch(/IF EXISTS \(SELECT 1 FROM pg_class WHERE relname = t\)/);
  });
});

describe('down', () => {
  it('drops the views', async () => {
    const sql = await sqlOf('down');
    for (const view of SERVING_VIEWS) {
      expect(sql).toMatch(new RegExp(`DROP VIEW IF EXISTS "${view}"`));
    }
  });

  it('restores the grants the core migration made, so it is a real inverse', async () => {
    const sql = await sqlOf('down');
    expect(sql).toMatch(/GRANT SELECT ON %I TO dsd_app/);
    for (const table of ['dsd_entries', 'dsd_senses', 'dsd_translations']) {
      expect(sql).toContain(`'${table}'`);
    }
  });

  it('does not restore access to compliance tables the core never granted', async () => {
    const sql = await sqlOf('down');
    const block = sql.match(/DO \$\$[\s\S]*?GRANT SELECT ON %I TO dsd_app[\s\S]*?END \$\$;/)![0];
    for (const table of ['dsd_similarity_results', 'dsd_ipa_candidates', 'dsd_provenance_events']) {
      expect(block).not.toContain(`'${table}'`);
    }
  });
});
