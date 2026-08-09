import { HardenDsdCommercialBoundary1785629500000 } from './1785629500000-HardenDsdCommercialBoundary';
import { DSD_MIGRATIONS } from './index';

async function upSql(): Promise<string> {
  const query = jest.fn().mockResolvedValue(undefined);
  await new HardenDsdCommercialBoundary1785629500000().up({ query } as any);
  return query.mock.calls.map(([sql]) => String(sql)).join('\n');
}

describe('signed release membership', () => {
  it('makes a release id identify one build and records exact entry membership', async () => {
    const sql = await upSql();
    expect(sql).toMatch(/UNIQUE INDEX "UQ_dsd_release_build_release_id"/);
    expect(sql).toMatch(/CREATE TABLE "dsd_release_entries"/);
    for (const table of [
      'senses', 'translations', 'examples', 'pronunciations', 'relations', 'audio_assets',
    ]) {
      expect(sql).toContain(`CREATE TABLE "dsd_release_${table}"`);
    }
    expect(sql).toMatch(/PRIMARY KEY \("release_build_id", "entry_id"\)/);
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON "dsd_release_entries"/);
  });

  it('exposes only complete builds to the serving role', async () => {
    const sql = await upSql();
    expect(sql).toMatch(/CREATE VIEW "dsd_complete_release_builds"[\s\S]*b\."entry_count" =/);
    expect(sql).toMatch(/b\."sense_count" =[\s\S]*b\."audio_asset_count" =/);
    expect(sql).toMatch(/CREATE VIEW "dsd_serving_release_entries"/);
    expect(sql).toMatch(/CREATE VIEW "dsd_serving_release_records"/);
    expect(sql).toMatch(/"manifest_bytes" text NOT NULL DEFAULT ''/);
    expect(sql).toMatch(/b\."sense_count", b\."translation_count"/);
    expect(sql).toMatch(/b\."pronunciation_count", b\."relation_count"/);
    expect(sql).toMatch(/GRANT SELECT ON "dsd_serving_release_entries"/);
  });

  it('invalidates a release when a signed member is no longer servable', async () => {
    const sql = await upSql();
    for (const view of [
      'dsd_serving_entries',
      'dsd_serving_senses',
      'dsd_serving_translations',
      'dsd_serving_examples',
      'dsd_serving_pronunciations',
      'dsd_serving_relations',
      'dsd_servable_audio',
    ]) {
      expect(sql).toContain(`JOIN "${view}"`);
    }
    expect(sql).toMatch(/count\(DISTINCT c\."relation_id"\)/);
    expect(sql).toMatch(/CREATE OR REPLACE VIEW "dsd_servable_audio"/);
    expect(sql).not.toMatch(/DROP VIEW IF EXISTS "dsd_servable_audio"/);
  });
});

describe('revision and evidence hardening', () => {
  it('uses partial logical-key uniqueness so a retired record can be superseded', async () => {
    const sql = await upSql();
    expect(sql).toMatch(/UQ_dsd_sense_entry_key_active[\s\S]*status" NOT IN \('retired', 'rejected'\)/);
    expect(sql).toMatch(/"supersedes_id"/);
    expect(sql).toMatch(/one_successor/);
  });

  it('compares the whole published row before retirement', async () => {
    const sql = await upSql();
    expect(sql).toMatch(/to_jsonb\(NEW\) - ARRAY\['status','updated_at'\]/);
  });

  it('requires pinned runtime, voice evidence and independent audio review', async () => {
    const sql = await upSql();
    expect(sql).toMatch(/CHK_dsd_audio_accepted_is_releasable/);
    expect(sql).toMatch(/"reviewed_by" <> "generator_actor"/);
    expect(sql).toMatch(/"voice_rights_evidence_id"/);
    expect(sql).toMatch(/release_runtime_digest" ~ '\^sha256:\[0-9a-f\]\{64\}\$'/);
  });

  it('requires an audio input record to belong to the same DSD entry', async () => {
    const sql = await upSql();
    expect(sql).toMatch(/dsd_audio_input_belongs_to_entry/);
    expect(sql).toMatch(/p\."id" = NEW\."input_record_id"[\s\S]*p\."dsd_entry_id" = NEW\."dsd_entry_id"/);
    expect(sql).toMatch(/BEFORE INSERT OR UPDATE OF "dsd_entry_id", "input_kind", "input_record_id"/);
  });
});

describe('registration and rollback policy', () => {
  it('is registered immediately before the operational metadata grant', () => {
    expect(DSD_MIGRATIONS.at(-2)?.name).toBe(
      'HardenDsdCommercialBoundary1785629500000',
    );
  });

  it('refuses a rollback that would silently reopen the commercial boundary', async () => {
    await expect(
      new HardenDsdCommercialBoundary1785629500000().down({ query: jest.fn() } as any),
    ).rejects.toThrow(/irreversible; roll forward/);
  });
});
