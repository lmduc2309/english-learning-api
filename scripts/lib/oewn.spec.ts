import * as fs from 'fs';
import * as path from 'path';

import {
  buildOewnCandidateArtifact,
  mapOewnPartOfSpeech,
  normalizeOewnLookupKey,
  normalizeOewnWrittenForm,
  OEWN_DOCTYPE,
  parseOewnChunks,
  renderOewnCandidateJson,
  renderOewnHeadwordCsv,
  renderOewnSenseCsv,
} from './oewn';
import { NgslCandidate } from './ngsl';
import { readResponseBodyWithExactSize } from '../oewn-source';

const FIXTURE_PATH = path.join(__dirname, '__fixtures__/oewn-tiny.xml');
const FIXTURE = fs.readFileSync(FIXTURE_PATH);
const TARGETS = new Set(['bank', 'be', 'bright', 'may', 'take off']);

async function parseFixture(chunks: Iterable<Buffer | string> = [FIXTURE]) {
  return parseOewnChunks(chunks, {
    targetLookupKeys: TARGETS,
    expectedCounts: {
      lexical_entries: 7,
      lemmas: 7,
      senses: 8,
      synsets: 8,
      definitions: 9,
      examples: 2,
      pronunciations: 4,
      forms: 2,
      ili_definitions: 1,
      sense_relations: 1,
      synset_relations: 2,
      relations: 3,
    },
    expectedUncompressedBytes: FIXTURE.length,
    maxUncompressedBytes: FIXTURE.length,
  });
}

function ngsl(word: string, sourceLemmas: string[], rank: number): NgslCandidate {
  return {
    word,
    rank,
    sourceMemberships: sourceLemmas.length > 1
      ? ['ngsl-core', 'ngsl-supplement']
      : ['ngsl-core'],
    sourceLemmas,
  };
}

describe('OEWN WN-LMF parser', () => {
  it('caps downloaded source bytes at the exact pinned size', async () => {
    const exact = new Response(Buffer.from('oewn')).body;
    await expect(readResponseBodyWithExactSize(exact, 4)).resolves.toEqual(
      Buffer.from('oewn'),
    );

    const oversized = new Response(Buffer.from('oewn')).body;
    await expect(readResponseBodyWithExactSize(oversized, 3)).rejects.toThrow(
      'exceeded pinned size',
    );

    const undersized = new Response(Buffer.from('oewn')).body;
    await expect(readResponseBodyWithExactSize(undersized, 5)).rejects.toThrow(
      'download size changed',
    );
  });

  it('normalizes only lookup keys and maps source POS without losing satellites', () => {
    expect(normalizeOewnWrittenForm('  May\u0301  ')).toBe('Maý');
    expect(normalizeOewnLookupKey('  MAY  ')).toBe('may');
    expect(mapOewnPartOfSpeech('n')).toBe('noun');
    expect(mapOewnPartOfSpeech('s')).toBe('adjective_satellite');
  });

  it('preserves stable IDs, entities, forms, source-scoped examples, and pronunciations', async () => {
    const parsed = await parseFixture();
    const bank = parsed.matchingEntries.find((entry) => entry.id === 'oewn-bank-n');
    const synset = parsed.matchingSynsets.get('oewn-00000003-n');

    expect(parsed.doctype).toBe(OEWN_DOCTYPE);
    expect(parsed.lexicon).toMatchObject({ id: 'oewn', version: '2025', language: 'en' });
    expect(bank).toMatchObject({
      writtenForm: 'bank',
      forms: ['banks'],
      senses: [
        { id: 'oewn-bank__1.14.00..', sourcePosition: 1 },
        { id: 'oewn-bank__1.17.00..', sourcePosition: 2 },
      ],
    });
    expect(bank?.pronunciations).toEqual([
      {
        value: 'bæŋk',
        variety: 'US',
        notation: null,
        phonemic: null,
        audio: 'https://example.test/bank.mp3',
        scope: 'lemma',
        form: null,
      },
      {
        value: 'bæŋk',
        variety: null,
        notation: null,
        phonemic: null,
        audio: null,
        scope: 'lemma',
        form: null,
      },
      {
        value: 'bæŋks',
        variety: null,
        notation: 'plural',
        phonemic: null,
        audio: null,
        scope: 'form',
        form: 'banks',
      },
    ]);
    expect(synset?.definitions).toEqual([
      { text: 'a financial & lending institution', sourceSense: null },
      {
        text: 'an institution that keeps money',
        sourceSense: 'oewn-bank__1.14.00..',
      },
    ]);
    expect(synset?.examples).toEqual([
      { text: 'The bank closes at five.', source: 'Fixture corpus', scope: 'synset' },
    ]);
  });

  it('produces identical results across arbitrary UTF-8 chunk boundaries', async () => {
    const whole = await parseFixture();
    const byteChunks = Array.from(FIXTURE, (byte) => Buffer.from([byte]));
    const chunked = await parseFixture(byteChunks);

    expect(chunked).toEqual(whole);
  });

  it('exports exact case-sensitive evidence and keeps case-fold collisions diagnostic-only', async () => {
    const parsed = await parseFixture();
    const candidates = [
      ngsl('be', ['be'], 1),
      ngsl('bank', ['bank'], 2),
      ngsl('may', ['may', 'May'], 3),
      ngsl('bright', ['bright'], 4),
    ];
    const artifact = buildOewnCandidateArtifact(candidates, parsed, {
      limit: candidates.length,
      ngslCandidatesSha256: '0'.repeat(64),
    });

    expect(artifact.headwords[0]).toMatchObject({
      normalized_word: 'be',
      match_status: 'case_collision',
      exact_entry_lemmas: [],
      casefold_only_entry_lemmas: ['BE'],
      candidates: [],
    });
    expect(artifact.headwords[1].candidates).toHaveLength(3);
    expect(artifact.headwords[1].candidates[0]).toMatchObject({
      sense_key: 'oewn:oewn-bank__1.14.00..',
      source_sense_position: 1,
      source_order_is_pedagogical: false,
      candidate_status: 'unreviewed',
    });
    expect(artifact.headwords[1].candidates[0].definitions_en).toHaveLength(2);
    expect(artifact.headwords[2]).toMatchObject({
      match_status: 'source_lemma_merge',
      exact_entry_lemmas: ['May', 'may'],
    });
    expect(artifact.headwords[3].candidates[0]).toMatchObject({
      part_of_speech: 'adjective_satellite',
      adjective_satellite: true,
    });
    expect(artifact.summary).toMatchObject({
      requested_headwords: 4,
      headwords_with_exact_entries: 3,
      source_senses: 6,
    });
    expect(renderOewnCandidateJson(artifact)).toEqual(renderOewnCandidateJson(artifact));
    expect(renderOewnHeadwordCsv(artifact).toString('utf8')).toContain('case_collision');
    expect(renderOewnSenseCsv(artifact).toString('utf8')).toContain('adjective_satellite');
  });

  it('rejects DOCTYPE changes, decompression overflow, duplicate IDs, and dangling references', async () => {
    const badDoctype = FIXTURE.toString('utf8').replace(
      OEWN_DOCTYPE,
      `${OEWN_DOCTYPE} [<!ENTITY unsafe "value">]`,
    );
    await expect(parseOewnChunks([badDoctype], {
      targetLookupKeys: TARGETS,
    })).rejects.toThrow('DOCTYPE changed');

    await expect(parseOewnChunks([FIXTURE], {
      targetLookupKeys: TARGETS,
      maxUncompressedBytes: FIXTURE.length - 1,
    })).rejects.toThrow('decompressed input exceeds');

    const duplicate = FIXTURE.toString('utf8').replace(
      'id="oewn-bank-v"',
      'id="oewn-bank-n"',
    );
    await expect(parseOewnChunks([duplicate], {
      targetLookupKeys: TARGETS,
    })).rejects.toThrow('duplicate XML id');

    const dangling = FIXTURE.toString('utf8').replace(
      'synset="oewn-00000008-v"',
      'synset="oewn-missing-v"',
    );
    await expect(parseOewnChunks([dangling], {
      targetLookupKeys: TARGETS,
    })).rejects.toThrow('dangling synset');

    const crossTypeDuplicate = FIXTURE.toString('utf8').replace(
      'id="oewn-take_off__2.38.00.."',
      'id="oewn-take_off-v"',
    );
    await expect(parseOewnChunks([crossTypeDuplicate], {
      targetLookupKeys: TARGETS,
    })).rejects.toThrow('duplicate XML id');

    const danglingDefinitionSense = FIXTURE.toString('utf8').replace(
      'sourceSense="oewn-bank__1.14.00.."',
      'sourceSense="oewn-missing-sense"',
    );
    await expect(parseOewnChunks([danglingDefinitionSense], {
      targetLookupKeys: TARGETS,
    })).rejects.toThrow('Definition has dangling sourceSense');

    const wrongDefinitionSynset = FIXTURE.toString('utf8').replace(
      'sourceSense="oewn-bank__1.14.00.."',
      'sourceSense="oewn-bank__1.17.00.."',
    );
    await expect(parseOewnChunks([wrongDefinitionSynset], {
      targetLookupKeys: TARGETS,
    })).rejects.toThrow('belongs to Synset');

    const danglingSubcat = FIXTURE.toString('utf8').replace(
      'subcat="via"',
      'subcat="missing-frame"',
    );
    await expect(parseOewnChunks([danglingSubcat], {
      targetLookupKeys: TARGETS,
    })).rejects.toThrow('dangling subcat SyntacticBehaviour');

    const danglingBehaviourSense = FIXTURE.toString('utf8').replace(
      'senses="oewn-take_off__2.38.00.."',
      'senses="oewn-missing-sense"',
    );
    await expect(parseOewnChunks([danglingBehaviourSense], {
      targetLookupKeys: TARGETS,
    })).rejects.toThrow('SyntacticBehaviour has dangling Sense target');
  });
});
