import * as fs from 'fs';
import * as path from 'path';

interface PilotExample {
  en: string;
  vi: string;
  review_status: string;
  reviewed_by?: string;
  reviewed_at?: string;
}

interface PilotRow {
  word: string;
  learner_rank: number;
  entry_status: string;
  sense_order: number;
  sense_key: string;
  part_of_speech: string;
  definition_en: string;
  definition_vi: string;
  usage_labels: string[];
  status: string;
  definition_source: string;
  definition_source_version: string;
  definition_source_artifact_sha256: string;
  translation_review_status: string;
  translation_reviewed_by?: string;
  translation_reviewed_at?: string;
  examples: PilotExample[];
  pronunciations?: unknown[];
  cefr_level?: string;
  reviewed_by?: string;
  reviewed_at?: string;
  review_notes?: string;
}

interface OewnCandidate {
  sense_key: string;
  part_of_speech: string;
}

interface OewnHeadword {
  normalized_word: string;
  candidates: OewnCandidate[];
}

const learnerCore = path.resolve(process.cwd(), 'data/learner-core');
const pilot = JSON.parse(fs.readFileSync(
  path.join(learnerCore, 'pilot-ngsl-10-draft-2026-07-20.json'),
  'utf8',
)) as PilotRow[];
const evidence = JSON.parse(fs.readFileSync(
  path.join(learnerCore, 'oewn-ngsl-first-100-candidates.json'),
  'utf8',
)) as { source: { version: string; sha256: string }; headwords: OewnHeadword[] };

const expectedCounts = {
  be: 4,
  have: 4,
  do: 1,
  say: 3,
  go: 4,
  time: 5,
  people: 2,
  year: 2,
  way: 3,
  day: 3,
} as const;

describe('10-word bilingual pilot batch', () => {
  it('contains the pinned 31-sense scope in learner order', () => {
    expect(pilot).toHaveLength(31);
    expect(Object.keys(expectedCounts)).toHaveLength(10);
    for (const [word, count] of Object.entries(expectedCounts)) {
      const rows = pilot.filter((row) => row.word === word);
      expect(rows).toHaveLength(count);
      expect(rows.map((row) => row.sense_order)).toEqual(
        Array.from({ length: count }, (_, index) => index + 1),
      );
      expect(new Set(rows.map((row) => row.learner_rank)).size).toBe(1);
    }
  });

  it('binds every selected row to an exact OEWN sense and part of speech', () => {
    const senseKeys = new Set<string>();
    for (const row of pilot) {
      const headword = evidence.headwords.find(
        (candidate) => candidate.normalized_word === row.word,
      );
      const sourceSense = headword?.candidates.find(
        (candidate) => candidate.sense_key === row.sense_key,
      );
      expect(sourceSense).toBeDefined();
      expect(row.part_of_speech).toBe(sourceSense?.part_of_speech);
      expect(senseKeys.has(row.sense_key)).toBe(false);
      senseKeys.add(row.sense_key);
    }
  });

  it('pins exact source provenance and remains entirely unreviewed draft content', () => {
    const serialized = JSON.stringify(pilot).toLocaleLowerCase('en-US');
    expect(serialized).not.toContain('cambridge');
    for (const row of pilot) {
      expect(row.definition_source).toBe('Open English WordNet');
      expect(row.definition_source_version).toBe(evidence.source.version);
      expect(row.definition_source_artifact_sha256).toBe(evidence.source.sha256);
      expect(row.entry_status).toBe('draft');
      expect(row.status).toBe('draft');
      expect(row.translation_review_status).toBe('draft');
      expect(row.reviewed_by).toBeUndefined();
      expect(row.reviewed_at).toBeUndefined();
      expect(row.translation_reviewed_by).toBeUndefined();
      expect(row.translation_reviewed_at).toBeUndefined();
      expect(row.cefr_level).toBeUndefined();
      expect(row.pronunciations).toBeUndefined();
      expect(row.definition_en.trim()).not.toBe('');
      expect(row.definition_vi.trim()).not.toBe('');
      expect(row.examples.length).toBeGreaterThan(0);
      for (const example of row.examples) {
        expect(example.review_status).toBe('draft');
        expect(example.reviewed_by).toBeUndefined();
        expect(example.reviewed_at).toBeUndefined();
      }
    }
  });

  it('records the known auxiliary-grammar gaps instead of presenting partial entries as complete', () => {
    for (const word of ['be', 'have', 'do']) {
      const notes = pilot
        .filter((row) => row.word === word)
        .map((row) => row.review_notes || '')
        .join(' ')
        .toLocaleLowerCase('en-US');
      expect(notes).toContain('incomplete');
      expect(notes).toContain('auxiliary');
    }
  });

  it('keeps easily confused core senses pedagogically distinct', () => {
    const row = (word: string, order: number) => pilot.find(
      (candidate) => candidate.word === word && candidate.sense_order === order,
    );

    expect(row('be', 1)?.definition_en).toContain('describe or classify');
    expect(row('be', 2)?.examples[0].en).toBe('My English teacher is Lan.');
    expect(row('say', 1)?.examples[0].en).toBe('Please say your name clearly.');
    expect(row('say', 2)?.examples[0].en).toContain('doctor');
    expect(row('people', 1)?.usage_labels).toContain('plural');
    expect(row('people', 1)?.review_notes).toContain('takes a plural verb');
    expect(row('time', 1)?.definition_en).toBe('A period available for doing something.');
    expect(row('time', 5)?.definition_en).toContain('continuing process');
  });
});
