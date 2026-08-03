import { AddDsdAudioAssets1785629100000 } from './1785629100000-AddDsdAudioAssets';
import { DSD_ENTITIES } from '../dsd-corpus.datasource';

async function sqlOf(direction: 'up' | 'down'): Promise<string> {
  const query = jest.fn().mockResolvedValue(undefined);
  await new AddDsdAudioAssets1785629100000()[direction]({ query } as any);
  return query.mock.calls.map(([s]) => String(s)).join('\n');
}

const BLOCKED = ['en_US-amy-medium', 'en_US-ryan-medium'];

describe('blocked voices are refused by the database', () => {
  it('names Amy and Ryan in a CHECK, not only in the generator', async () => {
    // A tool can be edited in a pull request. This needs a migration.
    const sql = await sqlOf('up');
    expect(sql).toMatch(/CHK_dsd_audio_blocked_voices/);
    for (const voice of BLOCKED) {
      expect(sql).toContain(`'${voice}'`);
    }
  });
});

describe('bytes are never overwritten', () => {
  it('keys storage by the content hash', async () => {
    const sql = await sqlOf('up');
    expect(sql).toMatch(/CHK_dsd_audio_storage_key/);
    // The key must agree with the hash it claims, so a mislabelled object is a
    // constraint violation rather than a silent mismatch.
    expect(sql).toMatch(/'dsd\/audio\/' \|\| "public_voice_id" \|\| '\/' \|\| "audio_sha256"/);
  });

  it('allows one live row per logical key, and quarantine alongside it', async () => {
    const sql = await sqlOf('up');
    expect(sql).toMatch(/CREATE UNIQUE INDEX "UQ_dsd_audio_one_live_per_key"/);
    expect(sql).toMatch(/WHERE "review_status" <> 'quarantined'/);
  });

  it('forces differing bytes at an existing key to arrive quarantined', async () => {
    const sql = await sqlOf('up');
    const fn = sql.match(/dsd_audio_conflict_must_quarantine[\s\S]*?\$fn\$;/)![0];
    expect(fn).toMatch(/never substituted/);
    expect(fn).toMatch(/NEW\."review_status" <> 'quarantined'/);
  });

  it('blocks acceptance while a quarantined conflict exists', async () => {
    const sql = await sqlOf('up');
    const fn = sql.match(/dsd_audio_quarantine_blocks_acceptance[\s\S]*?\$fn\$;/)![0];
    expect(fn).toMatch(/resolve it before accepting/);
  });

  it('treats identical bytes for the same generation as one asset', async () => {
    // Re-running the generator must be idempotent, not additive.
    expect(await sqlOf('up')).toMatch(/UQ_dsd_audio_logical_bytes.*UNIQUE \("logical_asset_key", "audio_sha256"\)/);
  });

  it('freezes the identity of an asset once written', async () => {
    const fn = (await sqlOf('up')).match(/dsd_audio_review_is_a_separate_act[\s\S]*?\$fn\$;/)![0];
    for (const frozen of ['audio_sha256', 'logical_asset_key', 'storage_key', 'model_sha256']) {
      expect(fn).toContain(`"${frozen}"`);
    }
  });
});

describe('a human listening decision cannot be synthesised', () => {
  it('refuses an asset created already reviewed', async () => {
    const fn = (await sqlOf('up')).match(/dsd_audio_review_is_a_separate_act[\s\S]*?\$fn\$;/)![0];
    expect(fn).toMatch(/cannot be created already reviewed/);
    expect(fn).toMatch(/NEW\."reviewed_by" IS NOT NULL/);
  });

  it('requires a named reviewer and a timestamp for any decision', async () => {
    expect(await sqlOf('up')).toMatch(/CHK_dsd_audio_decision_is_attributed/);
  });

  it('refuses a reviewer recorded against an undecided asset', async () => {
    // Otherwise a listening queue could be quietly pre-filled with names.
    const sql = await sqlOf('up');
    expect(sql).toMatch(/CHK_dsd_audio_no_premature_reviewer/);
    expect(sql).toMatch(/"reviewed_by" IS NULL OR "review_status" IN \('accepted','rejected'\)/);
  });

  it('does not re-open a decision', async () => {
    const fn = (await sqlOf('up')).match(/dsd_audio_review_is_a_separate_act[\s\S]*?\$fn\$;/)![0];
    expect(fn).toMatch(/is not re-opened, it is superseded/);
  });
});

describe('rights and QA gate the row', () => {
  it('requires approved training-dataset status to accept', async () => {
    const sql = await sqlOf('up');
    expect(sql).toMatch(/CHK_dsd_audio_accepted_needs_rights/);
    expect(sql).toMatch(/"training_dataset_status" = 'approved'/);
  });

  it('requires clean automated QA to accept', async () => {
    expect(await sqlOf('up')).toMatch(/CHK_dsd_audio_accepted_passes_qa/);
  });

  it('records the model licence and training dataset on every asset', async () => {
    const sql = await sqlOf('up');
    for (const column of ['model_license', 'training_dataset', 'model_sha256', 'model_revision']) {
      expect(sql).toMatch(new RegExp(`"${column}"`));
    }
  });
});

describe('the serving role cannot reach an unreviewed asset', () => {
  it('grants the serving role a view, never the table', async () => {
    const sql = await sqlOf('up');
    expect(sql).toMatch(/GRANT SELECT ON "dsd_servable_audio" TO dsd_app/);
    expect(sql).not.toMatch(/ON "dsd_audio_assets" TO dsd_app/);
  });

  it('restricts the view to accepted assets with rights and clean QA', async () => {
    const view = (await sqlOf('up')).match(/CREATE VIEW "dsd_servable_audio"[\s\S]*?qa_findings" = '\[\]'::jsonb/)![0];
    expect(view).toMatch(/"review_status" = 'accepted'/);
    expect(view).toMatch(/"training_dataset_status" = 'approved'/);
    expect(view).toMatch(/"qa_findings" = '\[\]'::jsonb/);
  });

  it('exposes no reviewer identity through the view', async () => {
    const view = (await sqlOf('up')).match(/CREATE VIEW "dsd_servable_audio"[\s\S]*?jsonb/)![0];
    expect(view).not.toMatch(/reviewed_by|review_notes|generator_actor/);
  });

  it('registers the entity, since scripts need it', () => {
    const names = (DSD_ENTITIES as Array<new () => unknown>).map((e) => e.name);
    expect(names).toContain('DsdAudioAsset');
  });
});

describe('down', () => {
  it('drops the view before the table it depends on', async () => {
    const sql = await sqlOf('down');
    expect(sql.indexOf('DROP VIEW')).toBeLessThan(sql.indexOf('DROP TABLE'));
  });

  it('drops only what it created', async () => {
    const sql = await sqlOf('down');
    expect(sql).toMatch(/DROP TABLE IF EXISTS "dsd_audio_assets"/);
    expect(sql).not.toMatch(/dsd_entries|dsd_pronunciations/);
  });
});
