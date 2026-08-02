import { StrengthenCommercialPublication1721403400000 } from './1721403400000-StrengthenCommercialPublication';

describe('StrengthenCommercialPublication1721403400000', () => {
  it('protects published senses when approved translations change or disappear', async () => {
    const queries: string[] = [];
    const runner = { query: jest.fn(async (sql: string) => queries.push(sql)) } as any;

    await new StrengthenCommercialPublication1721403400000().up(runner);
    const sql = queries.join('\n');

    expect(sql).toContain('AFTER INSERT OR UPDATE OR DELETE');
    expect(sql).toContain('TRG_translation_change_preserves_published_sense');
    expect(sql).toContain("s.\"status\" = 'published'");
    expect(sql).toContain("t.\"review_status\" = 'approved'");
  });

  it('requires evidence URLs and pins recognized OEWN and NGSL sources', async () => {
    const queries: string[] = [];
    const runner = { query: jest.fn(async (sql: string) => queries.push(sql)) } as any;

    await new StrengthenCommercialPublication1721403400000().up(runner);
    const sql = queries.join('\n');

    expect(sql).toContain('CHK_learner_translation_approved_source_url');
    expect(sql).toContain('CHK_learner_example_approved_source_url');
    expect(sql).toContain('CHK_learner_pronunciation_approved_source_url');
    expect(sql).toContain('CHK_learner_sense_published_oewn_lock');
    expect(sql).toContain('9ca6d1dcb75f822fdd66617f7d9da48142ace38dd544d6ad5e2feca1674ad3fe');
    expect(sql).toContain('CHK_learner_entry_ngsl_lock');
  });
});
