import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';

interface RegisteredSource {
  canonical_name: string;
  aliases: string[];
  scope: string[];
  commercial_status: string;
}

const normalize = (value: string) => value.trim().toLocaleLowerCase('en-US');

async function run(): Promise<void> {
  const registry = JSON.parse(
    fs.readFileSync(path.resolve('data/commercial-source-registry.json'), 'utf8'),
  ) as { sources: RegisteredSource[] };
  const allowed = new Map<string, Set<string>>();
  for (const source of registry.sources.filter((row) => row.commercial_status === 'approved')) {
    for (const scope of source.scope) {
      const names = allowed.get(scope) ?? new Set<string>();
      names.add(normalize(source.canonical_name));
      source.aliases.forEach((alias) => names.add(normalize(alias)));
      allowed.set(scope, names);
    }
  }

  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USERNAME || 'dictionary_user',
    password: process.env.DB_PASSWORD || 'dictionary_pass',
    database: process.env.DB_DATABASE || 'english_learning_db',
  });
  await client.connect();
  const failures: string[] = [];
  try {
    if (process.env.COMMERCIAL_SAFE_MODE !== 'true') {
      failures.push('COMMERCIAL_SAFE_MODE must be exactly true');
    }
    if (process.env.COMMERCIAL_ALLOW_GENERATED_CONTENT === 'true') {
      failures.push('COMMERCIAL_ALLOW_GENERATED_CONTENT must not be true');
    }
    const scalar = async (sql: string) =>
      Number((await client.query<{ value: string }>(sql)).rows[0].value);
    const published = await scalar(
      `SELECT count(*) value FROM learner_entries WHERE status='published'`,
    );
    if (published === 0) failures.push('no published learner entries');

    const invariantQueries: Array<[string, string]> = [
      ['learner-visible legacy definitions', `SELECT count(*) value FROM definitions WHERE is_learner_visible`],
      ['learner-visible legacy examples', `SELECT count(*) value FROM examples WHERE is_learner_visible`],
      ['published senses missing approved Vietnamese', `SELECT count(*) value FROM learner_senses s WHERE s.status='published' AND NOT EXISTS (SELECT 1 FROM learner_sense_translations t WHERE t.learner_sense_id=s.id AND lower(t.locale)='vi' AND t.review_status='approved')`],
      ['published senses with incomplete provenance', `SELECT count(*) value FROM learner_senses WHERE status='published' AND (definition_source_url IS NULL OR btrim(definition_source_url)='' OR definition_source_version IS NULL OR definition_source_artifact_sha256 !~ '^[0-9a-f]{64}$' OR reviewed_by IS NULL OR reviewed_at IS NULL)`],
      ['approved translations with incomplete evidence', `SELECT count(*) value FROM learner_sense_translations WHERE review_status='approved' AND (source_url IS NULL OR btrim(source_url)='' OR reviewed_by IS NULL OR reviewed_at IS NULL)`],
      ['approved examples with incomplete evidence', `SELECT count(*) value FROM learner_examples WHERE review_status='approved' AND (source_url IS NULL OR btrim(source_url)='' OR reviewed_by IS NULL OR reviewed_at IS NULL)`],
      ['approved pronunciations with incomplete evidence', `SELECT count(*) value FROM learner_pronunciations WHERE review_status='approved' AND (source_url IS NULL OR btrim(source_url)='' OR reviewed_by IS NULL OR reviewed_at IS NULL)`],
    ];
    for (const [name, sql] of invariantQueries) {
      const value = await scalar(sql);
      console.log(`${value === 0 ? 'PASS' : 'FAIL'} ${name}: ${value}`);
      if (value !== 0) failures.push(`${name}: ${value}`);
    }

    const sourceQueries: Array<[string, string]> = [
      ['definition', `SELECT DISTINCT definition_source source FROM learner_senses WHERE status='published'`],
      ['rank', `SELECT DISTINCT rank_source source FROM learner_entries WHERE status='published' AND learner_rank IS NOT NULL`],
      ['translation', `SELECT DISTINCT source FROM learner_sense_translations WHERE review_status='approved'`],
      ['example', `SELECT DISTINCT source FROM learner_examples WHERE review_status='approved'`],
      ['pronunciation', `SELECT DISTINCT source FROM learner_pronunciations WHERE review_status='approved'`],
    ];
    for (const [scope, sql] of sourceQueries) {
      const rows = await client.query<{ source: string }>(sql);
      for (const row of rows.rows) {
        if (!(allowed.get(scope)?.has(normalize(row.source)))) {
          failures.push(`${scope} source not approved: ${row.source}`);
        }
      }
    }

    console.log(`Commercial release audit: ${failures.length ? 'NO-GO' : 'GO'}`);
    console.log(`Published learner entries: ${published}`);
    failures.forEach((failure) => console.error(`BLOCKER ${failure}`));
    if (failures.length) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
