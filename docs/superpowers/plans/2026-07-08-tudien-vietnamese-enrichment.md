# tudien Vietnamese Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a data-pipeline script that reads the tudien StarDict EN→VI dataset and writes its Vietnamese meanings/examples into the existing `definitions.definition_vi` and `examples.example_vi` columns for words already in the database.

**Architecture:** A focused module set under `scripts/tudien/` holds pure, unit-tested functions (StarDict `.ifo`/`.idx` parsing, HTML entry parsing, VN→EN POS mapping, merge planning). A thin orchestrator `scripts/import-tudien.ts` wires them to a TypeORM `DataSource` and a CLI, following the existing pipeline-script convention. Pure functions are covered by jest; the DB orchestrator is verified via `--dry-run`/`--word`.

**Tech Stack:** TypeScript, ts-node (script execution), jest + ts-jest (unit tests), TypeORM + Postgres, Node `zlib` (dictzip decompression).

## Global Constraints

- Enrich EXISTING words only — never insert new `words`/`definitions` rows (`definitions.definition_en` is NOT NULL and tudien has no English definition).
- Scope is `definition_vi` and `example_vi` only. No IPA/CEFR/pronunciations/synonyms in this plan.
- Default behavior OVERWRITES existing Vietnamese with tudien's; `--fill-only` writes only where the target column is `NULL`.
- Word match key: `LOWER(words.word)` == lowercased tudien `.idx` key.
- Sense→definition assignment: group a word's definitions by `part_of_speech`; assign a tudien POS block's ordered senses to the definitions of the mapped English POS by `definition_order`; surplus senses join onto the last matching definition; a POS block with no matching DB POS contributes its first sense to the word's primary (lowest `definition_order`) definition.
- Example match: normalized `example_en` equality only (lowercase, collapse whitespace, strip trailing `.?!,;:`).
- Idempotent: re-running yields identical values (overwrite) or ~0 changes (`--fill-only`).
- Follow existing script conventions: standalone inline TypeORM `DataSource`, `dotenv` for DB config, TypeORM repositories for writes.
- Existing `npm test` (jest `rootDir: src`) must remain untouched; script tests run via a separate config.
- Entity property names (verbatim): `Word.word`, `Word.id`; `Definition.wordId`, `Definition.partOfSpeech`, `Definition.definitionEn`, `Definition.definitionVi`, `Definition.definitionOrder`, `Definition.examples`; `Example.exampleEn`, `Example.exampleVi`.
- VN→EN POS map (verbatim): `danh từ`→noun, `động từ`→verb, `tính từ`→adjective, `trạng từ`→adverb, `giới từ`→preposition, `đại từ`→pronoun, `mạo từ`→determiner, `liên từ`→conjunction, `thán từ`→interjection, `số từ`→numeral.
- Non-meaning tudien sections to exclude (verbatim): `đồng nghĩa/liên quan`, `nguồn gốc từ`.

---

## File Structure

```
english-learning-api/
  jest.scripts.config.js              # jest config scoped to scripts/ (new)
  scripts/
    import-tudien.ts                  # CLI orchestrator (DB + flags) — manual verify
    tudien/
      pos-map.ts                      # VN→EN POS map + mapVnPos + EXCLUDE_SECTIONS
      pos-map.spec.ts
      parse-entry.ts                  # parseEntry(html) → structured entry (pure)
      parse-entry.spec.ts
      __fixtures__/entries.ts         # exact real tudien HTML for tests
      stardict.ts                     # parseIfo, parseIdx (pure) + loadTudien (I/O)
      stardict.spec.ts
      merge.ts                        # planDefinitionUpdates / planExampleUpdates (pure)
      merge.spec.ts
  package.json                        # add test:tudien / import-tudien aliases
  data/vietnamese-sources/tudien/     # StarDict files (gitignored; downloaded manually)
```

Rationale: each pure concern is its own small file so it can be unit-tested and reasoned about independently; the orchestrator holds all the I/O and DB coupling.

---

## Task 1: Test harness + VN→EN POS map

**Files:**
- Create: `jest.scripts.config.js`
- Create: `scripts/tudien/pos-map.ts`
- Create: `scripts/tudien/pos-map.spec.ts`
- Modify: `package.json` (add `test:tudien` script)

**Interfaces:**
- Produces: `VN_POS_MAP: Record<string,string>`, `EXCLUDE_SECTIONS: Set<string>`, `mapVnPos(rawLabel: string): string | null`.

- [ ] **Step 1: Add the scripts jest config**

Create `jest.scripts.config.js`:
```javascript
module.exports = {
  rootDir: '.',
  roots: ['<rootDir>/scripts'],
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  testEnvironment: 'node',
};
```

- [ ] **Step 2: Add the npm alias**

In `package.json`, inside `"scripts"`, add:
```json
    "test:tudien": "jest --config jest.scripts.config.js",
```

- [ ] **Step 3: Write the failing test**

Create `scripts/tudien/pos-map.spec.ts`:
```typescript
import { mapVnPos, EXCLUDE_SECTIONS } from './pos-map';

describe('mapVnPos', () => {
  it('maps core Vietnamese parts of speech to English', () => {
    expect(mapVnPos('danh từ')).toBe('noun');
    expect(mapVnPos('động từ')).toBe('verb');
    expect(mapVnPos('tính từ')).toBe('adjective');
    expect(mapVnPos('trạng từ')).toBe('adverb');
    expect(mapVnPos('mạo từ')).toBe('determiner');
  });

  it('matches when the label has trailing irregular forms', () => {
    // e.g. tudien writes "động từ ran, run" for irregular verbs
    expect(mapVnPos('động từ ran, run')).toBe('verb');
  });

  it('is case/whitespace tolerant', () => {
    expect(mapVnPos('  Danh Từ  ')).toBe('noun');
  });

  it('returns null for unknown labels', () => {
    expect(mapVnPos('đồng nghĩa/liên quan')).toBeNull();
    expect(mapVnPos('xyz')).toBeNull();
  });

  it('lists the non-meaning sections to exclude', () => {
    expect(EXCLUDE_SECTIONS.has('đồng nghĩa/liên quan')).toBe(true);
    expect(EXCLUDE_SECTIONS.has('nguồn gốc từ')).toBe(true);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm run test:tudien`
Expected: FAIL — cannot find module `./pos-map` (not created yet).

- [ ] **Step 5: Implement `pos-map.ts`**

Create `scripts/tudien/pos-map.ts`:
```typescript
// Vietnamese part-of-speech labels (as used by tudien) → English POS used in
// the `definitions.part_of_speech` column.
export const VN_POS_MAP: Record<string, string> = {
  'danh từ': 'noun',
  'động từ': 'verb',
  'tính từ': 'adjective',
  'trạng từ': 'adverb',
  'giới từ': 'preposition',
  'đại từ': 'pronoun',
  'mạo từ': 'determiner',
  'liên từ': 'conjunction',
  'thán từ': 'interjection',
  'số từ': 'numeral',
};

// tudien reuses the "■" section marker for non-meaning sections; these must not
// be treated as POS/meaning blocks.
export const EXCLUDE_SECTIONS = new Set<string>([
  'đồng nghĩa/liên quan',
  'nguồn gốc từ',
]);

// Map a tudien POS label to an English POS, tolerating case, surrounding
// whitespace, and trailing irregular forms (e.g. "động từ ran, run").
export function mapVnPos(rawLabel: string): string | null {
  const label = rawLabel.trim().toLowerCase();
  for (const [vn, en] of Object.entries(VN_POS_MAP)) {
    if (label === vn || label.startsWith(vn + ' ')) return en;
  }
  return null;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run test:tudien`
Expected: PASS — 5 tests in `pos-map.spec.ts` green.

- [ ] **Step 7: Confirm the existing suite is unaffected**

Run: `npm test -- --listTests 2>/dev/null | grep -c tudien`
Expected: `0` (the default suite's `rootDir: src` does not pick up `scripts/` tests).

- [ ] **Step 8: Commit**

```bash
git add jest.scripts.config.js package.json scripts/tudien/pos-map.ts scripts/tudien/pos-map.spec.ts
git commit -m "feat(tudien): scripts test harness + VN→EN POS map"
```

---

## Task 2: HTML entry parser

**Files:**
- Create: `scripts/tudien/__fixtures__/entries.ts`
- Create: `scripts/tudien/parse-entry.ts`
- Create: `scripts/tudien/parse-entry.spec.ts`

**Interfaces:**
- Consumes: `EXCLUDE_SECTIONS` from `./pos-map`.
- Produces:
  - Types `ParsedExample { en: string; vi: string }`, `ParsedPosBlock { vnPos: string; senses: string[]; examples: ParsedExample[] }`, `ParsedEntry { headword: string; posBlocks: ParsedPosBlock[] }`.
  - `parseEntry(html: string): ParsedEntry`, `cleanText(html: string): string`, `stripSyllableDots(s: string): string`.

- [ ] **Step 1: Add the fixture file (exact real tudien HTML)**

Create `scripts/tudien/__fixtures__/entries.ts` (these strings are copied verbatim from real tudien entries; do not edit their contents):
```typescript
// Real tudien StarDict definition HTML, used as parser fixtures.
export const CAPACITOR = `<div style="line-height:1.4"><b style="font-size:130%">cap·aci·tor</b> — <b style="font-size:80%">[UK]</b> /kəˈ‍pæsɪtə(r)/ <b style="font-size:80%">[US]</b> /kəˈ‍pæsɪtər/<br/><div><b style="font-size:110%">■ danh từ</b></div><div style="margin-left:0"><div style="text-indent:12px"><b>1.&nbsp;&nbsp;</b>cái tụ điện</div></div><div><b style="font-size:110%">■ đồng nghĩa/liên quan</b><div style="text-indent:12px"><b>•&nbsp;&nbsp;</b><i>capacitors</i></div></div></div></div><br /><span style="font-size:80%">sachxy.com &bull; v20260411</span>`;

export const HAPPY = `<div style="line-height:1.4"><b style="font-size:130%">happy</b> — /ˈ‍hæpi/<br/><div style="font-size:80%"><b>CEFR:</b> A1</div><div><b style="font-size:110%">■ tính từ</b></div><div style="margin-left:0"><div style="text-indent:12px"><b>1.&nbsp;&nbsp;</b><b>vui sướng, vui lòng (một công thức xã giao)</b></div><div style="text-indent:24px">‣&nbsp;&nbsp;<i>I shall be happy to accept your invitation</i> ↔ tôi sung sướng nhận lời mời của ông</div><div style="text-indent:12px"><b>2.&nbsp;&nbsp;</b><b>may mắn, tốt phúc</b></div><div style="text-indent:12px"><b>3.&nbsp;&nbsp;</b><b>sung sướng, hạnh phúc</b></div><div style="text-indent:24px">‣&nbsp;&nbsp;<i>a happy marriage</i> ↔ một cuộc hôn nhân hạnh phúc</div><div style="text-indent:12px"><b>4.&nbsp;&nbsp;</b><b>khéo chọn, rất đúng, tài tình (từ, thành ngữ, câu nói...); thích hợp (cách xử sự...)</b></div><div style="text-indent:24px">‣&nbsp;&nbsp;<i>a happy retort</i> ↔ câu đối đáp rất tài tình</div><div style="text-indent:24px">‣&nbsp;&nbsp;<i>a happy guess</i> ↔ lời đoán rất đúng</div><div style="text-indent:12px"><b>5.&nbsp;&nbsp;</b><b>(từ lóng) bị choáng váng, bị ngây ngất (vì bom...)</b></div><div style="text-indent:12px"><b>★&nbsp;&nbsp;</b><b><i>as happy as the day is long/as a sandboy/as Larry</i></b> ↔ rất vui mừng, rất sung sướng</div></div><div><b style="font-size:110%">■ đồng nghĩa/liên quan</b><div style="text-indent:12px"><b>•&nbsp;&nbsp;</b><i style="color:#666666">happily</i></div></div><div><b style="font-size:110%">■ nguồn gốc từ</b><div style="text-indent:12px"><b>•&nbsp;&nbsp;</b>Middle English</div></div></div><br /><span style="font-size:80%">sachxy.com &bull; v20260411</span>`;

export const THE = `<div style="line-height:1.4"><b style="font-size:130%">the</b> — /ðə/ /ði/ /ðiː/<br/><div style="font-size:80%"><b>CEFR:</b> A1</div><div><b style="font-size:110%">■ mạo từ</b></div><div style="margin-left:0"><div style="text-indent:12px"><b>1.&nbsp;&nbsp;</b><b>(dùng để làm cho danh từ đứng sau nó nói đến một người, vật, sự kiện hoặc nhóm riêng biệt, rõ ràng) cái, con, người...</b></div><div style="text-indent:24px">‣&nbsp;&nbsp;<i>the house</i> ↔ cái nhà</div><div style="text-indent:24px">‣&nbsp;&nbsp;<i>the cat</i> ↔ con mèo</div><div style="text-indent:12px"><b>2.&nbsp;&nbsp;</b><b>ấy, này (người, cái, con...)</b></div></div><div><b style="font-size:110%">■ trạng từ</b></div><div style="margin-left:0"><div style="text-indent:12px"></div><div style="text-indent:24px">‣&nbsp;&nbsp;<i>so much the better</i> ↔ càng tốt</div></div><div><b style="font-size:110%">■ đồng nghĩa/liên quan</b><div style="text-indent:12px"><b>•&nbsp;&nbsp;</b><i>ye</i></div></div></div><br /><span style="font-size:80%">sachxy.com &bull; v20260411</span>`;
```

- [ ] **Step 2: Write the failing test**

Create `scripts/tudien/parse-entry.spec.ts`:
```typescript
import { parseEntry, cleanText, stripSyllableDots } from './parse-entry';
import { CAPACITOR, HAPPY, THE } from './__fixtures__/entries';

describe('cleanText', () => {
  it('strips tags, decodes entities, collapses whitespace', () => {
    expect(cleanText('<b>1.&nbsp;&nbsp;</b>cái tụ điện')).toBe('1. cái tụ điện');
  });
});

describe('stripSyllableDots', () => {
  it('removes the middot and zero-width joiner', () => {
    expect(stripSyllableDots('cap·aci·tor')).toBe('capacitor');
  });
});

describe('parseEntry', () => {
  it('parses a single-sense noun with no examples (capacitor)', () => {
    const e = parseEntry(CAPACITOR);
    expect(e.headword).toBe('capacitor');
    expect(e.posBlocks).toHaveLength(1); // synonym section excluded
    expect(e.posBlocks[0].vnPos).toBe('danh từ');
    expect(e.posBlocks[0].senses).toEqual(['cái tụ điện']);
    expect(e.posBlocks[0].examples).toEqual([]);
  });

  it('parses multiple numbered senses + examples, skips ★ idioms and excluded sections (happy)', () => {
    const e = parseEntry(HAPPY);
    expect(e.headword).toBe('happy');
    expect(e.posBlocks).toHaveLength(1); // "đồng nghĩa" + "nguồn gốc" excluded
    const b = e.posBlocks[0];
    expect(b.vnPos).toBe('tính từ');
    expect(b.senses).toHaveLength(5); // ★ idiom line is NOT a sense
    expect(b.senses[0]).toBe('vui sướng, vui lòng (một công thức xã giao)');
    expect(b.senses[4]).toBe('(từ lóng) bị choáng váng, bị ngây ngất (vì bom...)');
    expect(b.examples).toContainEqual({
      en: 'I shall be happy to accept your invitation',
      vi: 'tôi sung sướng nhận lời mời của ông',
    });
    expect(b.examples).toContainEqual({ en: 'a happy marriage', vi: 'một cuộc hôn nhân hạnh phúc' });
    expect(b.examples).toHaveLength(4);
  });

  it('parses multiple POS blocks incl. an example-only block (the)', () => {
    const e = parseEntry(THE);
    expect(e.headword).toBe('the');
    expect(e.posBlocks.map(b => b.vnPos)).toEqual(['mạo từ', 'trạng từ']);
    expect(e.posBlocks[0].senses).toHaveLength(2);
    expect(e.posBlocks[1].senses).toEqual([]); // trạng từ has an empty sense div
    expect(e.posBlocks[1].examples).toContainEqual({ en: 'so much the better', vi: 'càng tốt' });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test:tudien`
Expected: FAIL — cannot find module `./parse-entry`.

- [ ] **Step 4: Implement `parse-entry.ts`**

Create `scripts/tudien/parse-entry.ts`:
```typescript
import { EXCLUDE_SECTIONS } from './pos-map';

export interface ParsedExample {
  en: string;
  vi: string;
}
export interface ParsedPosBlock {
  vnPos: string;
  senses: string[];
  examples: ParsedExample[];
}
export interface ParsedEntry {
  headword: string;
  posBlocks: ParsedPosBlock[];
}

const HEADWORD_RE = /<b style="font-size:130%">(.*?)<\/b>/;
const SECTION_RE = /<b style="font-size:110%">■\s*([^<]+?)\s*<\/b>/g;
const INDENT_DIV_RE = /<div style="text-indent:(12|24)px">(.*?)<\/div>/g;
const ITALIC_RE = /<i[^>]*>(.*?)<\/i>/;

// Strip HTML tags, decode the handful of entities tudien uses, drop the
// zero-width joiner, and collapse whitespace.
export function cleanText(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&bull;/g, '•')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/‍/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Remove middot syllable separators and the zero-width joiner from a headword.
export function stripSyllableDots(s: string): string {
  return s.replace(/[·‍]/g, '');
}

export function parseEntry(html: string): ParsedEntry {
  const hw = HEADWORD_RE.exec(html);
  const headword = hw ? stripSyllableDots(cleanText(hw[1])) : '';

  // Locate every section header ("■ <label>") and its span.
  const headers: Array<{ label: string; contentStart: number; markerStart: number }> = [];
  let m: RegExpExecArray | null;
  SECTION_RE.lastIndex = 0;
  while ((m = SECTION_RE.exec(html)) !== null) {
    headers.push({ label: m[1].trim(), markerStart: m.index, contentStart: SECTION_RE.lastIndex });
  }

  const posBlocks: ParsedPosBlock[] = [];
  for (let i = 0; i < headers.length; i++) {
    const label = headers[i].label;
    if (EXCLUDE_SECTIONS.has(label.toLowerCase())) continue;

    const start = headers[i].contentStart;
    const end = i + 1 < headers.length ? headers[i + 1].markerStart : html.length;
    const chunk = html.slice(start, end);

    const senses: string[] = [];
    const examples: ParsedExample[] = [];
    let d: RegExpExecArray | null;
    INDENT_DIV_RE.lastIndex = 0;
    while ((d = INDENT_DIV_RE.exec(chunk)) !== null) {
      const indent = d[1];
      const inner = d[2];
      if (indent === '12') {
        const text = cleanText(inner);
        const sm = /^(\d+)\.\s*(.+)$/.exec(text); // numbered senses only (skip ★/•)
        if (sm) senses.push(sm[2].trim());
      } else {
        const it = ITALIC_RE.exec(inner);
        const arrow = inner.indexOf('↔');
        if (!it || arrow === -1) continue;
        const en = cleanText(it[1]);
        const vi = cleanText(inner.slice(arrow + 1));
        if (en && vi) examples.push({ en, vi });
      }
    }
    posBlocks.push({ vnPos: label, senses, examples });
  }

  return { headword, posBlocks };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:tudien`
Expected: PASS — all `parse-entry.spec.ts` and `pos-map.spec.ts` tests green.

- [ ] **Step 6: Commit**

```bash
git add scripts/tudien/parse-entry.ts scripts/tudien/parse-entry.spec.ts scripts/tudien/__fixtures__/entries.ts
git commit -m "feat(tudien): HTML entry parser with real fixtures"
```

---

## Task 3: StarDict reader

**Files:**
- Create: `scripts/tudien/stardict.ts`
- Create: `scripts/tudien/stardict.spec.ts`

**Interfaces:**
- Produces:
  - Types `IfoInfo { version: string; wordcount: number; sametypesequence: string; bookname: string }`, `IdxRecord { word: string; offset: number; size: number }`.
  - `parseIfo(text: string): IfoInfo`, `parseIdx(buf: Buffer): IdxRecord[]`, `loadTudien(dir: string): Map<string, string>` (map of lowercased headword → definition HTML).

- [ ] **Step 1: Write the failing test**

Create `scripts/tudien/stardict.spec.ts`:
```typescript
import { parseIfo, parseIdx } from './stardict';

describe('parseIfo', () => {
  it('extracts key fields', () => {
    const ifo = [
      "StarDict's dict ifo file",
      'version=3.0.0',
      'bookname=tudien Anh-Việt tổng hợp (en-vi)',
      'wordcount=235561',
      'idxfilesize=4751217',
      'sametypesequence=h',
    ].join('\n');
    const info = parseIfo(ifo);
    expect(info.version).toBe('3.0.0');
    expect(info.wordcount).toBe(235561);
    expect(info.sametypesequence).toBe('h');
    expect(info.bookname).toContain('Anh-Việt');
  });
});

describe('parseIdx', () => {
  it('reads null-terminated word + 4-byte BE offset + 4-byte BE size records', () => {
    // "ab" @ offset 0 size 5 ; "cd" @ offset 5 size 3
    const rec = (word: string, off: number, size: number) => {
      const w = Buffer.from(word, 'utf8');
      const nums = Buffer.alloc(9); // \0 + off(4) + size(4)
      nums.writeUInt8(0, 0);
      nums.writeUInt32BE(off, 1);
      nums.writeUInt32BE(size, 5);
      return Buffer.concat([w, nums]);
    };
    const buf = Buffer.concat([rec('ab', 0, 5), rec('cd', 5, 3)]);
    expect(parseIdx(buf)).toEqual([
      { word: 'ab', offset: 0, size: 5 },
      { word: 'cd', offset: 5, size: 3 },
    ]);
  });

  it('preserves UTF-8 headwords', () => {
    const w = Buffer.from('cà phê', 'utf8');
    const nums = Buffer.alloc(9);
    nums.writeUInt32BE(10, 1);
    nums.writeUInt32BE(20, 5);
    const [r] = parseIdx(Buffer.concat([w, nums]));
    expect(r).toEqual({ word: 'cà phê', offset: 10, size: 20 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:tudien`
Expected: FAIL — cannot find module `./stardict`.

- [ ] **Step 3: Implement `stardict.ts`**

Create `scripts/tudien/stardict.ts`:
```typescript
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';

export interface IfoInfo {
  version: string;
  wordcount: number;
  sametypesequence: string;
  bookname: string;
}

export interface IdxRecord {
  word: string;
  offset: number;
  size: number;
}

export function parseIfo(text: string): IfoInfo {
  const get = (key: string): string => {
    const m = new RegExp('^' + key + '=(.*)$', 'm').exec(text);
    return m ? m[1].trim() : '';
  };
  return {
    version: get('version'),
    wordcount: parseInt(get('wordcount') || '0', 10),
    sametypesequence: get('sametypesequence'),
    bookname: get('bookname'),
  };
}

export function parseIdx(buf: Buffer): IdxRecord[] {
  const records: IdxRecord[] = [];
  let i = 0;
  while (i < buf.length) {
    let j = i;
    while (j < buf.length && buf[j] !== 0) j++;
    const word = buf.slice(i, j).toString('utf8');
    const offset = buf.readUInt32BE(j + 1);
    const size = buf.readUInt32BE(j + 5);
    records.push({ word, offset, size });
    i = j + 9;
  }
  return records;
}

function findStardictFiles(dir: string): { ifo: string; idx: string; dict: string | null; dictDz: string | null } {
  const entries = fs.readdirSync(dir);
  const find = (pred: (e: string) => boolean) => {
    const f = entries.find(pred);
    return f ? path.join(dir, f) : null;
  };
  const ifo = find(e => e.endsWith('.ifo'));
  const idx = find(e => e.endsWith('.idx'));
  const dictDz = find(e => e.endsWith('.dict.dz'));
  const dict = find(e => e.endsWith('.dict'));
  if (!ifo || !idx) throw new Error(`Missing .ifo/.idx StarDict files in ${dir}`);
  return { ifo, idx, dict, dictDz };
}

// Read the three StarDict files from a directory and return a map of
// lowercased headword → definition HTML. The .dict.dz (dictzip) is a valid
// gzip stream, so zlib decompresses it whole (~108 MB, acceptable for a
// one-off pipeline run). Duplicate keys are last-wins.
export function loadTudien(dir: string): Map<string, string> {
  const files = findStardictFiles(dir);
  const info = parseIfo(fs.readFileSync(files.ifo, 'utf8'));
  if (info.sametypesequence !== 'h') {
    throw new Error(`Unsupported sametypesequence "${info.sametypesequence}" (expected "h") in ${files.ifo}`);
  }
  const records = parseIdx(fs.readFileSync(files.idx));

  let dict: Buffer;
  if (files.dict) {
    dict = fs.readFileSync(files.dict);
  } else if (files.dictDz) {
    dict = zlib.gunzipSync(fs.readFileSync(files.dictDz));
  } else {
    throw new Error(`No .dict or .dict.dz found in ${dir}`);
  }

  const map = new Map<string, string>();
  for (const r of records) {
    map.set(r.word.toLowerCase(), dict.slice(r.offset, r.offset + r.size).toString('utf8'));
  }
  return map;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:tudien`
Expected: PASS — `stardict.spec.ts` green (plus prior suites).

- [ ] **Step 5: Commit**

```bash
git add scripts/tudien/stardict.ts scripts/tudien/stardict.spec.ts
git commit -m "feat(tudien): StarDict .ifo/.idx parser + loader"
```

---

## Task 4: Merge planner

**Files:**
- Create: `scripts/tudien/merge.ts`
- Create: `scripts/tudien/merge.spec.ts`

**Interfaces:**
- Consumes: `mapVnPos` from `./pos-map`; `ParsedEntry` from `./parse-entry`.
- Produces:
  - Types `DbExample { id: number | string; exampleEn: string; exampleVi: string | null }`, `DbDefinition { id: number | string; partOfSpeech: string; definitionOrder: number; definitionVi: string | null; examples: DbExample[] }`, `MergeOptions { fillOnly: boolean }`, `DefinitionUpdate { definitionId: number | string; definitionVi: string }`, `ExampleUpdate { exampleId: number | string; exampleVi: string }`.
  - `normalizeEn(s: string): string`, `planDefinitionUpdates(defs, entry, opts): DefinitionUpdate[]`, `planExampleUpdates(defs, entry, opts): ExampleUpdate[]`.

- [ ] **Step 1: Write the failing test**

Create `scripts/tudien/merge.spec.ts`:
```typescript
import { planDefinitionUpdates, planExampleUpdates, normalizeEn, DbDefinition } from './merge';
import { ParsedEntry } from './parse-entry';

const entry = (posBlocks: ParsedEntry['posBlocks']): ParsedEntry => ({ headword: 'x', posBlocks });

describe('normalizeEn', () => {
  it('lowercases, collapses whitespace, strips trailing punctuation', () => {
    expect(normalizeEn('The  House.')).toBe('the house');
  });
});

describe('planDefinitionUpdates', () => {
  it('assigns senses of a POS block to same-POS definitions by order', () => {
    const defs: DbDefinition[] = [
      { id: 1, partOfSpeech: 'noun', definitionOrder: 1, definitionVi: null, examples: [] },
      { id: 2, partOfSpeech: 'noun', definitionOrder: 2, definitionVi: null, examples: [] },
    ];
    const e = entry([{ vnPos: 'danh từ', senses: ['nghĩa 1', 'nghĩa 2'], examples: [] }]);
    expect(planDefinitionUpdates(defs, e, { fillOnly: false })).toEqual([
      { definitionId: 1, definitionVi: 'nghĩa 1' },
      { definitionId: 2, definitionVi: 'nghĩa 2' },
    ]);
  });

  it('joins surplus senses onto the last matching definition', () => {
    const defs: DbDefinition[] = [
      { id: 1, partOfSpeech: 'noun', definitionOrder: 1, definitionVi: null, examples: [] },
    ];
    const e = entry([{ vnPos: 'danh từ', senses: ['a', 'b', 'c'], examples: [] }]);
    expect(planDefinitionUpdates(defs, e, { fillOnly: false })).toEqual([
      { definitionId: 1, definitionVi: 'a; b; c' },
    ]);
  });

  it('falls back to the primary definition when no POS matches', () => {
    const defs: DbDefinition[] = [
      { id: 5, partOfSpeech: 'verb', definitionOrder: 2, definitionVi: null, examples: [] },
      { id: 4, partOfSpeech: 'verb', definitionOrder: 1, definitionVi: null, examples: [] },
    ];
    const e = entry([{ vnPos: 'danh từ', senses: ['chỉ có danh từ'], examples: [] }]);
    // primary = lowest definitionOrder = id 4
    expect(planDefinitionUpdates(defs, e, { fillOnly: false })).toEqual([
      { definitionId: 4, definitionVi: 'chỉ có danh từ' },
    ]);
  });

  it('fill-only skips definitions that already have a Vietnamese value', () => {
    const defs: DbDefinition[] = [
      { id: 1, partOfSpeech: 'noun', definitionOrder: 1, definitionVi: 'đã có', examples: [] },
      { id: 2, partOfSpeech: 'noun', definitionOrder: 2, definitionVi: null, examples: [] },
    ];
    const e = entry([{ vnPos: 'danh từ', senses: ['x', 'y'], examples: [] }]);
    expect(planDefinitionUpdates(defs, e, { fillOnly: true })).toEqual([
      { definitionId: 2, definitionVi: 'y' },
    ]);
  });

  it('overwrites existing values by default', () => {
    const defs: DbDefinition[] = [
      { id: 1, partOfSpeech: 'noun', definitionOrder: 1, definitionVi: 'cũ', examples: [] },
    ];
    const e = entry([{ vnPos: 'danh từ', senses: ['mới'], examples: [] }]);
    expect(planDefinitionUpdates(defs, e, { fillOnly: false })).toEqual([
      { definitionId: 1, definitionVi: 'mới' },
    ]);
  });

  it('returns nothing when the word has no definitions', () => {
    const e = entry([{ vnPos: 'danh từ', senses: ['x'], examples: [] }]);
    expect(planDefinitionUpdates([], e, { fillOnly: false })).toEqual([]);
  });
});

describe('planExampleUpdates', () => {
  it('sets example_vi by normalized English match', () => {
    const defs: DbDefinition[] = [
      {
        id: 1, partOfSpeech: 'noun', definitionOrder: 1, definitionVi: null,
        examples: [
          { id: 11, exampleEn: 'The house.', exampleVi: null },
          { id: 12, exampleEn: 'unmatched', exampleVi: null },
        ],
      },
    ];
    const e = entry([{ vnPos: 'danh từ', senses: [], examples: [{ en: 'the house', vi: 'cái nhà' }] }]);
    expect(planExampleUpdates(defs, e, { fillOnly: false })).toEqual([
      { exampleId: 11, exampleVi: 'cái nhà' },
    ]);
  });

  it('fill-only skips examples that already have a Vietnamese value', () => {
    const defs: DbDefinition[] = [
      {
        id: 1, partOfSpeech: 'noun', definitionOrder: 1, definitionVi: null,
        examples: [{ id: 11, exampleEn: 'the cat', exampleVi: 'đã dịch' }],
      },
    ];
    const e = entry([{ vnPos: 'danh từ', senses: [], examples: [{ en: 'the cat', vi: 'con mèo' }] }]);
    expect(planExampleUpdates(defs, e, { fillOnly: true })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:tudien`
Expected: FAIL — cannot find module `./merge`.

- [ ] **Step 3: Implement `merge.ts`**

Create `scripts/tudien/merge.ts`:
```typescript
import { mapVnPos } from './pos-map';
import { ParsedEntry } from './parse-entry';

export interface DbExample {
  id: number | string;
  exampleEn: string;
  exampleVi: string | null;
}
export interface DbDefinition {
  id: number | string;
  partOfSpeech: string;
  definitionOrder: number;
  definitionVi: string | null;
  examples: DbExample[];
}
export interface MergeOptions {
  fillOnly: boolean;
}
export interface DefinitionUpdate {
  definitionId: number | string;
  definitionVi: string;
}
export interface ExampleUpdate {
  exampleId: number | string;
  exampleVi: string;
}

const SENSE_JOIN = '; ';

export function normalizeEn(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.?!,;:]+$/, '')
    .trim();
}

export function planDefinitionUpdates(
  defs: DbDefinition[],
  entry: ParsedEntry,
  opts: MergeOptions,
): DefinitionUpdate[] {
  if (defs.length === 0) return [];

  const byPos = new Map<string, DbDefinition[]>();
  for (const d of defs) {
    const key = (d.partOfSpeech || '').toLowerCase();
    if (!byPos.has(key)) byPos.set(key, []);
    byPos.get(key)!.push(d);
  }
  for (const arr of byPos.values()) arr.sort((a, b) => a.definitionOrder - b.definitionOrder);

  const primary = [...defs].sort((a, b) => a.definitionOrder - b.definitionOrder)[0];

  // Accumulate assigned senses per definition (insertion-ordered).
  const assigned = new Map<DbDefinition, string[]>();
  const push = (def: DbDefinition, sense: string) => {
    if (!assigned.has(def)) assigned.set(def, []);
    assigned.get(def)!.push(sense);
  };

  for (const block of entry.posBlocks) {
    if (block.senses.length === 0) continue;
    const enPos = mapVnPos(block.vnPos);
    const targets = enPos ? byPos.get(enPos) || [] : [];
    if (targets.length === 0) {
      push(primary, block.senses[0]); // fallback: first sense → primary
      continue;
    }
    block.senses.forEach((sense, i) => {
      const target = targets[Math.min(i, targets.length - 1)];
      push(target, sense);
    });
  }

  const updates: DefinitionUpdate[] = [];
  for (const [def, senses] of assigned) {
    if (opts.fillOnly && def.definitionVi != null && def.definitionVi !== '') continue;
    updates.push({ definitionId: def.id, definitionVi: senses.join(SENSE_JOIN) });
  }
  return updates;
}

export function planExampleUpdates(
  defs: DbDefinition[],
  entry: ParsedEntry,
  opts: MergeOptions,
): ExampleUpdate[] {
  const pool = new Map<string, string>();
  for (const block of entry.posBlocks) {
    for (const ex of block.examples) {
      const key = normalizeEn(ex.en);
      if (key && !pool.has(key)) pool.set(key, ex.vi);
    }
  }

  const updates: ExampleUpdate[] = [];
  for (const def of defs) {
    for (const ex of def.examples) {
      if (opts.fillOnly && ex.exampleVi != null && ex.exampleVi !== '') continue;
      const vi = pool.get(normalizeEn(ex.exampleEn));
      if (vi) updates.push({ exampleId: ex.id, exampleVi: vi });
    }
  }
  return updates;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:tudien`
Expected: PASS — `merge.spec.ts` green (plus prior suites).

- [ ] **Step 5: Commit**

```bash
git add scripts/tudien/merge.ts scripts/tudien/merge.spec.ts
git commit -m "feat(tudien): merge planner for definition_vi / example_vi"
```

---

## Task 5: CLI orchestrator + npm aliases + data doc

**Files:**
- Create: `scripts/import-tudien.ts`
- Modify: `package.json` (add `import-tudien`, `import-tudien:dry` aliases)

**Interfaces:**
- Consumes: `loadTudien` (`./tudien/stardict`), `parseEntry` (`./tudien/parse-entry`), `planDefinitionUpdates`/`planExampleUpdates` (`./tudien/merge`).
- Produces: an executable pipeline script (no exported API).

**Note on entity imports:** match the import paths used by the sibling script `scripts/import-vietnamese-meanings.ts` (e.g. `import { Word } from '../src/dictionary/entities/word.entity';`). Open that file first and copy its `DataSource` construction block and entity import paths verbatim to stay consistent with the codebase.

- [ ] **Step 1: Read the existing sibling script for the DataSource pattern**

Run: `sed -n '320,345p' scripts/import-vietnamese-meanings.ts`
Expected: shows the inline `new DataSource({...})` block (host/port/user/pass/db from `process.env`, `entities: [...]`). Copy this block and the entity import paths for use below.

- [ ] **Step 2: Implement `scripts/import-tudien.ts`**

Create `scripts/import-tudien.ts` (replace the `DataSource` config block and entity import paths with the exact ones copied from `import-vietnamese-meanings.ts` in Step 1):
```typescript
import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { Word } from '../src/dictionary/entities/word.entity';
import { Definition } from '../src/dictionary/entities/definition.entity';
import { Example } from '../src/dictionary/entities/example.entity';
import { Pronunciation } from '../src/dictionary/entities/pronunciation.entity';
import { WordForm } from '../src/dictionary/entities/word-form.entity';
import { Synonym } from '../src/dictionary/entities/synonym.entity';
import { loadTudien } from './tudien/stardict';
import { parseEntry } from './tudien/parse-entry';
import { planDefinitionUpdates, planExampleUpdates, DbDefinition } from './tudien/merge';

dotenv.config();

const TUDIEN_DIR = path.resolve(__dirname, '../data/vietnamese-sources/tudien');

interface Args {
  dryRun: boolean;
  fillOnly: boolean;
  word: string | null;
  limit: number | null;
}

function parseArgs(argv: string[]): Args {
  const has = (f: string) => argv.includes(f);
  const val = (f: string): string | null => {
    const i = argv.indexOf(f);
    return i !== -1 && i + 1 < argv.length ? argv[i + 1] : null;
  };
  const limitRaw = val('--limit');
  return {
    dryRun: has('--dry-run'),
    fillOnly: has('--fill-only'),
    word: val('--word'),
    limit: limitRaw ? parseInt(limitRaw, 10) : null,
  };
}

// Replace this block with the exact DataSource config copied from
// scripts/import-vietnamese-meanings.ts (Step 1).
function createDataSource(): DataSource {
  return new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_DATABASE || 'english_learning',
    entities: [Word, Definition, Example, Pronunciation, WordForm, Synonym],
    synchronize: false,
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `tudien enrichment — ${args.dryRun ? 'DRY RUN' : 'WRITE'}, ` +
      `${args.fillOnly ? 'fill-only' : 'overwrite'}` +
      `${args.word ? `, word=${args.word}` : ''}${args.limit ? `, limit=${args.limit}` : ''}`,
  );

  console.log(`Loading StarDict from ${TUDIEN_DIR} ...`);
  const tudien = loadTudien(TUDIEN_DIR);
  console.log(`Loaded ${tudien.size} tudien headwords.`);

  const ds = createDataSource();
  await ds.initialize();
  const wordRepo = ds.getRepository(Word);
  const defRepo = ds.getRepository(Definition);

  let wordsProcessed = 0;
  let wordsMatched = 0;
  let defChanges = 0;
  let exChanges = 0;

  const PAGE = 500;
  let page = 0;

  // Fetch DB words in pages (or a single word with --word).
  while (true) {
    let words: Word[];
    if (args.word) {
      const w = await wordRepo.findOne({ where: { word: args.word.toLowerCase() } });
      words = w ? [w] : [];
    } else {
      words = await wordRepo.find({ order: { id: 'ASC' }, skip: page * PAGE, take: PAGE });
    }
    if (words.length === 0) break;

    for (const w of words) {
      if (args.limit != null && wordsProcessed >= args.limit) break;
      wordsProcessed++;
      const html = tudien.get(w.word.toLowerCase());
      if (!html) continue;
      wordsMatched++;

      const entry = parseEntry(html);
      const defs = (await defRepo.find({
        where: { wordId: w.id },
        relations: ['examples'],
        order: { definitionOrder: 'ASC' },
      })) as unknown as DbDefinition[];

      const opts = { fillOnly: args.fillOnly };
      const defUpdates = planDefinitionUpdates(defs, entry, opts);
      const exUpdates = planExampleUpdates(defs, entry, opts);

      if (!args.dryRun && (defUpdates.length || exUpdates.length)) {
        await ds.transaction(async (m) => {
          for (const u of defUpdates) await m.update(Definition, u.definitionId, { definitionVi: u.definitionVi });
          for (const u of exUpdates) await m.update(Example, u.exampleId, { exampleVi: u.exampleVi });
        });
      }
      defChanges += defUpdates.length;
      exChanges += exUpdates.length;

      if (args.word) {
        console.log(JSON.stringify({ word: w.word, defUpdates, exUpdates }, null, 2));
      }
    }

    if (args.word) break;
    if (args.limit != null && wordsProcessed >= args.limit) break;
    page++;
  }

  console.log(
    `Done. words scanned=${wordsProcessed}, matched in tudien=${wordsMatched}, ` +
      `definition_vi ${args.dryRun ? 'would change' : 'changed'}=${defChanges}, ` +
      `example_vi ${args.dryRun ? 'would change' : 'changed'}=${exChanges}.`,
  );

  await ds.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Add npm aliases**

In `package.json` `"scripts"`, add:
```json
    "import-tudien": "ts-node scripts/import-tudien.ts",
    "import-tudien:dry": "ts-node scripts/import-tudien.ts --dry-run",
```

- [ ] **Step 4: Add the data-acquisition note to the script header**

At the very top of `scripts/import-tudien.ts`, above the imports, add a comment block:
```typescript
/**
 * tudien Vietnamese enrichment.
 *
 * DATA: download the StarDict release and unzip into data/vietnamese-sources/tudien/:
 *   curl -L -o /tmp/tudien.zip \
 *     https://github.com/redphx/tudien/releases/download/v20260411/tudien-stardict-en-vi-20260411.zip
 *   mkdir -p data/vietnamese-sources/tudien && unzip -o /tmp/tudien.zip -d data/vietnamese-sources/tudien
 * (produces *.ifo, *.idx, *.dict.dz — the script reads them directly.)
 *
 * USAGE:
 *   npm run import-tudien:dry            # counts only, no writes
 *   npm run import-tudien -- --word run  # inspect a single word
 *   npm run import-tudien                # full run (overwrites definition_vi/example_vi)
 *   npm run import-tudien -- --fill-only # only fill NULLs
 *   npm run import-tudien -- --limit 100 # cap words processed
 */
```

- [ ] **Step 5: Ensure the data dir is gitignored**

Run: `grep -q "data/vietnamese-sources" .gitignore && echo "already ignored" || echo "data/vietnamese-sources/" >> .gitignore`
Expected: prints `already ignored`, or appends the ignore rule. (StarDict binaries must never be committed.)

- [ ] **Step 6: Verify — full unit suite still green + TypeScript compiles**

Run: `npm run test:tudien`
Expected: PASS — pos-map, parse-entry, stardict, merge suites all green.

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i import-tudien || echo "no type errors in import-tudien"`
Expected: `no type errors in import-tudien`.

- [ ] **Step 7: Verify — manual DB run (requires Postgres populated + StarDict files downloaded)**

Download the data (see the header block in Step 4), then:

1. `npm run import-tudien -- --word capacitor`
   Expected: prints a JSON object with `defUpdates` containing `definitionVi: "cái tụ điện"` for the noun definition (if `capacitor` exists in the DB).
2. `npm run import-tudien -- --word run`
   Expected: senses land on the correct part-of-speech definitions (verb senses on verb definitions, noun senses on noun definitions).
3. `npm run import-tudien:dry`
   Expected: a final line with plausible non-zero `matched in tudien` and `would change` counts.
4. `npm run import-tudien` (full write), then `npm run import-tudien -- --fill-only`
   Expected: the second run reports `example_vi changed=0` and `definition_vi changed=0` (idempotent under fill-only).
5. Spot-check in psql: `SELECT d.definition_vi FROM definitions d JOIN words w ON w.id=d.word_id WHERE w.word='capacitor';`
   Expected: the tudien Vietnamese meaning.

- [ ] **Step 8: Commit**

```bash
git add scripts/import-tudien.ts package.json .gitignore
git commit -m "feat(tudien): CLI orchestrator to enrich definition_vi/example_vi"
```

---

## Self-Review Notes

- **Spec coverage:** StarDict reading + `sametypesequence=h` assert → Task 3 (`loadTudien`/`parseIfo`). HTML→structured parse (senses, examples, POS, exclude synonym/etymology, strip dots/ZWJ) → Task 2. VN→EN POS map incl. trailing irregular forms → Task 1. Match by `LOWER(word)`, POS+order sense assignment, surplus-join, primary fallback, overwrite vs `--fill-only`, example en-match → Task 4 + orchestrator Task 5. Flags (`--dry-run`/`--fill-only`/`--word`/`--limit`), data-download doc, gitignore, npm aliases, verification → Task 5.
- **Two intentional deviations from the spec, flagged for the human:**
  1. **Example matching is en-text-only.** The spec mentioned an "else by order" example fallback; that risks pairing the wrong Vietnamese to an example, so this plan uses normalized-English equality only. Effect: some `example_vi` may be left unfilled rather than guessed.
  2. **`loadTudien` decompresses the whole `.dict` (~108 MB) into memory** rather than random-access offset reads (the spec's performance nicety). Simpler and correct for a one-off run; output is identical.
- **Idempotency:** overwrite mode re-writes identical tudien values; `--fill-only` skips populated columns — verified in merge unit tests and the manual re-run step.
- **Name/type consistency:** `mapVnPos`, `EXCLUDE_SECTIONS`, `parseEntry`, `ParsedEntry`, `loadTudien`, `parseIfo`, `parseIdx`, `planDefinitionUpdates`, `planExampleUpdates`, `DbDefinition`, `normalizeEn`, and `MergeOptions.fillOnly` are used identically across the module files and the orchestrator. Entity property names match the entities confirmed in the spec.
- **Test harness isolation:** `jest.scripts.config.js` (`roots: scripts/`) leaves the default `npm test` (`rootDir: src`) untouched — confirmed in Task 1 Step 7.
- **Assumption to watch during execution:** the exact `DataSource` config/entity import paths must be copied from `import-vietnamese-meanings.ts` (Task 5 Step 1); the block shown is a template with best-guess defaults.
