import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';

dotenv.config();

interface RegistrySource {
  canonical_name: string;
  aliases: string[];
  scope: Array<'definition' | 'rank' | 'translation' | 'example' | 'pronunciation'>;
  commercial_status: string;
}

const allowEmpty = process.argv.includes('--allow-empty');
const registryPath = path.resolve('data/commercial-source-registry.json');
const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8')) as {
  sources: RegistrySource[];
};
const normalized = (value: string) => value.trim().toLocaleLowerCase('en-US');
const approvedByScope = new Map<string, Set<string>>();
for (const source of registry.sources.filter((row) => row.commercial_status === 'approved')) {
  for (const scope of source.scope) {
    const names = approvedByScope.get(scope) ?? new Set<string>();
    names.add(normalized(source.canonical_name));
    for (const alias of source.aliases) names.add(normalized(alias));
    approvedByScope.set(scope, names);
  }
}

const client = new Client({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USERNAME || 'dictionary_user',
  password: process.env.DB_PASSWORD || 'dictionary_pass',
  database: process.env.DB_DATABASE || 'english_learning_db',
});

async function count(sql: string): Promise<number> {
  const result = await client.query<{ count: string }>(sql);
  return Number(result.rows[0].count);
}

async function distinct(sql: string): Promise<string[]> {
  const result = await client.query<{ source: string }>(sql);
  return result.rows.map((row) => row.source);
}

async function main(): Promise<void> {
  await client.connect();
  const failures: string[] = [];
  if (process.env.COMMERCIAL_SAFE_MODE !== 'true') {
    failures.push('COMMERCIAL_SAFE_MODE must be exactly true');
  }
  if (process.env.COMMERCIAL_ALLOW_GENERATED_CONTENT === 'true') {
    failures.push('COMMERCIAL_ALLOW_GENERATED_CONTENT must not be true');
  }
  const checks: Array<[string, number, number]> = [];
  const checkZero = async (name: string, sql: string) => {
    const value = await count(sql);
    checks.push([name, value, 0]);
    if (value !== 0) failures.push(`${name}: expected 0, found ${value}`);
  };

  const publishedEntries = await count(
    `SELECT count(*) FROM learner_entries WHERE status='published'`,
  );
  if (publishedEntries === 0 && !allowEmpty) {
    failures.push('published learner entries: expected at least 1, found 0');
  }

  await checkZero(
    'learner-visible legacy definitions',
    `SELECT count(*) FROM definitions WHERE is_learner_visible`,
  );
  await checkZero(
    'learner-visible legacy examples',
    `SELECT count(*) FROM examples WHERE is_learner_visible`,
  );
  await checkZero(
    'published senses missing approved Vietnamese',
    `SELECT count(*) FROM learner_senses s
      WHERE s.status='published' AND NOT EXISTS (
        SELECT 1 FROM learner_sense_translations t
        WHERE t.learner_sense_id=s.id AND lower(t.locale)='vi'
          AND t.review_status='approved')`,
  );
  await checkZero(
    'published senses with incomplete provenance',
    `SELECT count(*) FROM learner_senses
      WHERE status='published' AND (
        definition_source_url IS NULL OR btrim(definition_source_url)=''
        OR definition_source_version IS NULL OR btrim(definition_source_version)=''
        OR definition_source_artifact_sha256 !~ '^[0-9a-f]{64}$'
        OR reviewed_by IS NULL OR btrim(reviewed_by)='' OR reviewed_at IS NULL)`,
  );
  for (const [label, table] of [
    ['approved translations', 'learner_sense_translations'],
    ['approved examples', 'learner_examples'],
    ['approved pronunciations', 'learner_pronunciations'],
  ]) {
    await checkZero(
      `${label} with incomplete evidence`,
      `SELECT count(*) FROM ${table} WHERE review_status='approved' AND (
        source_url IS NULL OR btrim(source_url)=''
        OR reviewed_by IS NULL OR btrim(reviewed_by)='' OR reviewed_at IS NULL)`,
    );
  }

  const sourceQueries: Array<[string, string]> = [
    ['definition', `SELECT DISTINCT definition_source source FROM learner_senses WHERE status='published'`],
    ['rank', `SELECT DISTINCT rank_source source FROM learner_entries WHERE status='published' AND learner_rank IS NOT NULL`],
    ['translation', `SELECT DISTINCT source FROM learner_sense_translations WHERE review_status='approved'`],
    ['example', `SELECT DISTINCT source FROM learner_examples WHERE review_status='approved'`],
    ['pronunciation', `SELECT DISTINCT source FROM learner_pronunciations WHERE review_status='approved'`],
  ];
  for (const [scope, sql] of sourceQueries) {
    const allowed = approvedByScope.get(scope) ?? new Set<string>();
    for (const source of await distinct(sql)) {
      if (!allowed.has(normalized(source))) {
        failures.push(`${scope} source is not commercially approved: ${source}`);
      }
    }
  }

  console.log(`Commercial release audit: ${failures.length ? 'NO-GO' : 'GO'}`);
  console.log(`Published learner entries: ${publishedEntries}`);
  for (const [name, actual, expected] of checks) {
    console.log(`${actual === expected ? 'PASS' : 'FAIL'} ${name}: ${actual}`);
  }
  for (const failure of failures) console.error(`BLOCKER ${failure}`);
  if (failures.length) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => client.end());
