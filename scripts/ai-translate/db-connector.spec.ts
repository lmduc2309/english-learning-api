import { DbConnector } from './db-connector';

function fakeQb() {
  const calls: Array<[string, unknown[]]> = [];
  const qb: any = {};
  for (const m of ['leftJoinAndSelect', 'where', 'andWhere', 'orderBy', 'addOrderBy', 'take']) {
    qb[m] = (...args: unknown[]) => {
      calls.push([m, args]);
      return qb;
    };
  }
  qb.getMany = async () => [];
  qb.__calls = calls;
  return qb;
}

function connectorWith(qb: any) {
  const connector = new DbConnector();
  (connector as any).dataSource = {
    getRepository: () => ({ createQueryBuilder: () => qb }),
  };
  return connector;
}

function predicatesOf(qb: any): string {
  return qb.__calls
    .filter(([m]: [string]) => m === 'where' || m === 'andWhere')
    .map(([, a]: [string, unknown[]]) => String(a[0]))
    .join(' ');
}

describe('DbConnector CJK targeting', () => {
  it('selects definitions flagged vi_contains_cjk rather than NULL Vietnamese', async () => {
    const qb = fakeQb();
    await connectorWith(qb).fetchCjkContaminatedDefinitions(10, new Set());
    const predicates = predicatesOf(qb);

    expect(predicates).toContain('vi_contains_cjk');
    expect(predicates).toContain('IS NOT NULL');
    expect(predicates).not.toContain('definitionVi IS NULL');
  });

  it('selects examples flagged vi_contains_cjk rather than NULL Vietnamese', async () => {
    const qb = fakeQb();
    await connectorWith(qb).fetchCjkContaminatedExamples(10, new Set());
    const predicates = predicatesOf(qb);

    expect(predicates).toContain('vi_contains_cjk');
    expect(predicates).toContain('IS NOT NULL');
    expect(predicates).not.toContain('exampleVi IS NULL');
  });

  it('leaves the NULL-targeted fetchers untouched', async () => {
    const qb = fakeQb();
    await connectorWith(qb).fetchUntranslatedDefinitions(10, new Set());
    expect(predicatesOf(qb)).toContain('definitionVi IS NULL');
  });
});

describe('DbConnector atomic flag recompute', () => {
  function connectorRecording(sqls: string[]) {
    const connector = new DbConnector();
    (connector as any).dataSource = {
      transaction: async (fn: (m: any) => Promise<void>) =>
        fn({
          query: async (sql: string) => {
            sqls.push(sql);
          },
        }),
    };
    return connector;
  }

  it('rewrites Vietnamese flags in the same statement as the text', async () => {
    const sqls: string[] = [];
    await connectorRecording(sqls).updateDefinitionVietnamese([{ id: 1, vi: 'xin chào' }]);
    expect(sqls).toHaveLength(1);
    const sql = sqls[0];

    expect(sql).toMatch(/SET[\s\S]*"definition_vi"\s*=\s*v\.vi/);
    expect(sql).toMatch(/"quality_flags"\s*=/);
    expect(sql).toContain('vi_contains_cjk');
    expect(sql).toContain('vi_equals_en');
    expect(sql).toContain('missing_vi');
    // English-derived flags must survive the Vietnamese rewrite.
    expect(sql).toContain("'raw_markup','empty_definition'");
    expect(sql).not.toMatch(/is_learner_visible"?\s*=\s*true/i);
  });

  it('preserves example_too_long on examples', async () => {
    const sqls: string[] = [];
    await connectorRecording(sqls).updateExampleVietnamese([{ id: 1, vi: 'xin chào' }]);
    expect(sqls[0]).toContain("'raw_markup','empty_definition','example_too_long'");
  });
});
