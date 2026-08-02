/**
 * Run the deterministic quality rules over DSD content.
 *
 * This connects to DSD and to nothing else. The rules themselves live in
 * src/dsd-corpus/quality and import nothing at all, so no rule can reach a
 * legacy row; this file's only job is to fetch DSD records, run them, and set
 * an exit code.
 *
 * A critical finding exits non-zero. A warning is printed and counted and does
 * not — but nothing here marks a record as passing either, because the same
 * rules run again at publication. There is no stored verdict to go stale.
 *
 * USAGE:
 *   npm run dsd:quality:audit
 *   npm run dsd:quality:audit -- --batch B-001
 *   npm run dsd:quality:audit -- --entry <uuid> --json
 */
import * as dotenv from 'dotenv';
import { buildDsdCorpusConfig } from '../../src/dsd-corpus/dsd-corpus.config';
import { createDsdDataSource } from '../../src/dsd-corpus/dsd-corpus.datasource';
import {
  DefinitionRecord,
  ExampleRecord,
  QualityFinding,
  TranslationRecord,
  checkCorpus,
  checkDefinition,
  checkExample,
  checkTranslation,
  criticalFindings,
  summarize,
} from '../../src/dsd-corpus/quality/dsd-quality';

dotenv.config();

export interface QualityInput {
  definitions: DefinitionRecord[];
  translations: TranslationRecord[];
  examples: ExampleRecord[];
}

/**
 * Run every rule over a set of records. Pure, so the publication gate can call
 * it on a snapshot it already holds rather than re-querying.
 */
export function auditRecords(input: QualityInput): QualityFinding[] {
  return [
    ...input.definitions.flatMap(checkDefinition),
    ...input.translations.flatMap(checkTranslation),
    ...input.examples.flatMap(checkExample),
    ...checkCorpus({ definitions: input.definitions, examples: input.examples }),
  ];
}

export function formatFindings(findings: QualityFinding[]): string[] {
  return findings
    .slice()
    .sort((a, b) =>
      a.severity === b.severity ? a.rule.localeCompare(b.rule) : a.severity === 'critical' ? -1 : 1,
    )
    .map((f) => `  ${f.severity.padEnd(8)} ${f.rule.padEnd(26)} ${f.entityId}  ${f.message}`);
}

const DEFINITIONS_SQL = `
  SELECT s.id AS "entityId", e.headword, s.part_of_speech AS "partOfSpeech",
         s.definition_en AS "definitionEn", s.usage_labels AS "usageLabels"
    FROM dsd_senses s JOIN dsd_entries e ON e.id = s.dsd_entry_id
   WHERE ($1::varchar IS NULL OR s.batch_id = $1)
     AND ($2::uuid IS NULL OR s.dsd_entry_id = $2)`;

const TRANSLATIONS_SQL = `
  SELECT t.id AS "entityId", e.headword, s.definition_en AS "definitionEn",
         t.locale, t.text
    FROM dsd_translations t
    JOIN dsd_senses s ON s.id = t.dsd_sense_id
    JOIN dsd_entries e ON e.id = s.dsd_entry_id
   WHERE ($1::varchar IS NULL OR t.batch_id = $1)
     AND ($2::uuid IS NULL OR s.dsd_entry_id = $2)`;

const EXAMPLES_SQL = `
  SELECT x.id AS "entityId", e.headword, s.part_of_speech AS "partOfSpeech",
         x.example_en AS "exampleEn", x.example_vi AS "exampleVi"
    FROM dsd_examples x
    JOIN dsd_senses s ON s.id = x.dsd_sense_id
    JOIN dsd_entries e ON e.id = s.dsd_entry_id
   WHERE ($1::varchar IS NULL OR x.batch_id = $1)
     AND ($2::uuid IS NULL OR s.dsd_entry_id = $2)`;

function arg(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function main(): Promise<void> {
  const config = buildDsdCorpusConfig();
  if (config.errors.length > 0) {
    throw new Error('DSD configuration invalid:\n  - ' + config.errors.join('\n  - '));
  }

  const params = [arg('batch'), arg('entry')];
  // The auditor role cannot edit content. An audit that could fix what it finds
  // would be an audit nobody has to act on.
  const ds = createDsdDataSource('audit', config);
  await ds.initialize();

  let findings: QualityFinding[];
  let counts: { definitions: number; translations: number; examples: number };
  try {
    const input: QualityInput = {
      definitions: await ds.query(DEFINITIONS_SQL, params),
      translations: await ds.query(TRANSLATIONS_SQL, params),
      examples: await ds.query(EXAMPLES_SQL, params),
    };
    counts = {
      definitions: input.definitions.length,
      translations: input.translations.length,
      examples: input.examples.length,
    };
    findings = auditRecords(input);
  } finally {
    await ds.destroy();
  }

  const critical = criticalFindings(findings);

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ counts, summary: summarize(findings), findings }, null, 2));
  } else {
    console.log(
      `Audited ${counts.definitions} definition(s), ${counts.translations} translation(s), ` +
        `${counts.examples} example(s).`,
    );
    if (findings.length === 0) {
      console.log('No findings.');
    } else {
      for (const line of formatFindings(findings)) console.log(line);
      console.log('');
      for (const [key, count] of Object.entries(summarize(findings)).sort()) {
        console.log(`  ${String(count).padStart(5)}  ${key}`);
      }
    }
  }

  if (critical.length > 0) {
    console.error(`\n${critical.length} critical finding(s).`);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
