import * as fs from 'fs';
import * as path from 'path';
import { AddDsdIpaCandidates1785629000000 } from './1785629000000-AddDsdIpaCandidates';
import { DSD_ENTITIES } from '../dsd-corpus.datasource';

async function sqlOf(direction: 'up' | 'down'): Promise<string> {
  const query = jest.fn().mockResolvedValue(undefined);
  await new AddDsdIpaCandidates1785629000000()[direction]({ query } as any);
  return query.mock.calls.map(([s]) => String(s)).join('\n');
}

describe('a candidate cannot become content', () => {
  it('has no status meaning approved or published', async () => {
    const sql = await sqlOf('up');
    const check = sql.match(/CHK_dsd_ipa_candidate_status[\s\S]*?\)\)/)![0];
    expect(check).toContain("'candidate'");
    expect(check).toContain("'rejected'");
    expect(check).toContain("'superseded'");
    for (const forbidden of ['approved', 'published', 'in_review', 'accepted', 'final']) {
      expect(check).not.toContain(`'${forbidden}'`);
    }
  });

  it('gives a pronunciation no way to reference a candidate', async () => {
    // A FK the other way would let a published pronunciation cite generated
    // output as its source, and the release gate would have a path to one.
    const sql = await sqlOf('up');
    const references = [...sql.matchAll(/REFERENCES\s+"([a-z_]+)"/gi)].map((m) => m[1]);
    expect(references).toEqual(['dsd_entries']);
    expect(sql).not.toMatch(/dsd_pronunciations/);
  });

  it('cannot be edited into saying something else', async () => {
    const sql = await sqlOf('up');
    const fn = sql.match(/dsd_ipa_candidate_immutable[\s\S]*?\$fn\$;/)![0];
    for (const frozen of ['candidate_ipa', 'tool_id', 'tool_revision', 'artifact_sha256']) {
      expect(fn).toContain(`"${frozen}"`);
    }
  });
});

describe('the API cannot reach candidates', () => {
  it('grants the serving role nothing', async () => {
    expect(await sqlOf('up')).not.toMatch(/TO dsd_app/);
  });

  it('is absent from the entity list the application registers', async () => {
    // Without a registered entity there is no repository, so the running API
    // has no TypeORM path to the table even if a grant were added by mistake.
    const names = (DSD_ENTITIES as Array<new () => unknown>).map((e) => e.name);
    expect(names).not.toContain('DsdIpaCandidate');
    expect(names).toContain('DsdPronunciation');
  });

  it('is queried by no application code', () => {
    // The table is named in a comment on DsdPronunciation and in the migration
    // registry, which has to import the class to run it. Neither is a way to
    // read a row, so this looks for the shapes that are: a repository, an
    // entity reference in application code, or SQL naming the table.
    const src = path.resolve(__dirname, '../..');
    const allowed = ['dsd-corpus/migrations/index.ts'];
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, item.name);
        const relative = path.relative(src, full);
        if (item.isDirectory()) {
          walk(full);
          continue;
        }
        if (!item.name.endsWith('.ts') || item.name.endsWith('.spec.ts')) continue;
        if (item.name.includes('ipa-candidate') || item.name.includes('AddDsdIpaCandidates')) continue;
        if (allowed.includes(relative)) continue;

        const code = fs
          .readFileSync(full, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '');
        if (/dsd_ipa_candidates|DsdIpaCandidate/.test(code)) offenders.push(relative);
      }
    };
    walk(src);
    expect(offenders).toEqual([]);
  });
});

describe('a candidate must be reproducible', () => {
  it('records the tool, its revision and the artifact digest', async () => {
    const sql = await sqlOf('up');
    for (const column of ['tool_id', 'tool_revision', 'artifact_sha256', 'configuration']) {
      expect(sql).toMatch(new RegExp(`"${column}"`));
    }
    expect(sql).toMatch(/CHK_dsd_ipa_candidate_artifact/);
  });

  it('records a digest of the input it was generated from', async () => {
    expect(await sqlOf('up')).toMatch(/"input_headword_hash"\s+char\(64\)\s+NOT NULL/);
  });

  it('does not accumulate rows when the same run is repeated', async () => {
    expect(await sqlOf('up')).toMatch(/UQ_dsd_ipa_candidate_input/);
  });
});

describe('the tool locks', () => {
  const locks = ['misaki', 'phonetic-matching'].map((name) =>
    JSON.parse(
      fs.readFileSync(path.resolve(__dirname, `../../../data/dsd/tools/${name}.lock.json`), 'utf8'),
    ),
  );

  it.each(locks.map((l) => [l.toolId, l]))('%s pins a real revision', (_id, lock) => {
    expect(lock.revision).toMatch(/^[0-9a-f]{40}$/);
    expect(lock.revisionPinnedFrom).toMatch(/^https:\/\/api\.github\.com\//);
    expect(lock.revisionDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it.each(locks.map((l) => [l.toolId, l]))('%s records its licence', (_id, lock) => {
    expect(['Apache-2.0', 'MIT']).toContain(lock.license);
  });

  it.each(locks.map((l) => [l.toolId, l]))(
    '%s has no artifact digest yet, and says so rather than inventing one',
    (_id, lock) => {
      // A pinned revision fixes what the code says. The artifact digest fixes
      // what was executed. Generation is blocked until both exist.
      expect(lock.artifactSha256).toBeNull();
    },
  );
});

describe('down', () => {
  it('drops only what it created', async () => {
    const sql = await sqlOf('down');
    expect(sql).toMatch(/DROP TABLE IF EXISTS "dsd_ipa_candidates"/);
    expect(sql).not.toMatch(/dsd_pronunciations|dsd_entries/);
  });
});
