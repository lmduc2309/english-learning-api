import * as fs from 'fs';
import * as path from 'path';
import { InventoryRow, loadInventoryFile, normalizeHeadword } from '../../inventory';
import { stableDsdEntryId } from '../inventory-planner';
import { LocalRequest, LocalResult, readJsonl, sha256, validateLocalResult } from './protocol';
import { loadSelectionManifest } from './selection';
import { checkExample } from '../../../../src/dsd-corpus/quality/dsd-quality';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function required(name: string): string {
  const value = arg(name)?.trim();
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

function writeNew(file: string, value: unknown): void {
  const resolved = path.resolve(process.cwd(), file);
  if (fs.existsSync(resolved)) throw new Error(`refusing to overwrite: ${resolved}`);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  console.log(`Wrote ${Array.isArray(value) ? value.length : 1} payload(s): ${resolved}`);
}

function loadCompleted(input: string, results: string): Array<{ request: LocalRequest; result: LocalResult }> {
  const requests = readJsonl<LocalRequest>(path.resolve(process.cwd(), input));
  const requestMap = new Map(requests.map((request) => [request.request_id, request]));
  const output: Array<{ request: LocalRequest; result: LocalResult }> = [];
  for (const result of readJsonl<LocalResult>(path.resolve(process.cwd(), results))) {
    const request = requestMap.get(result.request_id);
    if (!request) throw new Error(`${result.request_id}: no matching request`);
    const errors = validateLocalResult(result, request);
    if (errors.length) throw new Error(`${result.request_id}: ${errors.join('; ')}`);
    if (result.state !== 'completed') throw new Error(`${result.request_id}: not completed`);
    output.push({ request, result });
  }
  if (output.length !== requests.length) throw new Error(`only ${output.length}/${requests.length} requests completed`);
  return output;
}

function deterministicSeed(...parts: unknown[]): number {
  return Number.parseInt(sha256(JSON.stringify(parts)).slice(0, 8), 16);
}

function englishPayload(row: InventoryRow) {
  return {
    dsd_entry_id: row.dsd_entry_id,
    headword: row.headword,
    expected_part_of_speech: row.part_of_speech_expectation,
    product_rationale: row.product_rationale,
    seed: deterministicSeed(row.dsd_entry_id),
  };
}

function prepareEnglish(): void {
  const inventory = loadInventoryFile(path.resolve(process.cwd(), required('inventory')));
  if (inventory.errors.length) throw new Error(`invalid inventory: ${inventory.errors.join('; ')}`);
  const limit = Number(arg('limit') ?? 50);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > inventory.rows.length) throw new Error('invalid --limit');
  const offset = Number(arg('offset') ?? 0);
  const stride = Number(arg('stride') ?? 1);
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(stride) || stride < 1) {
    throw new Error('--offset must be non-negative and --stride must be positive');
  }
  const selected = Array.from({ length: limit }, (_, index) => inventory.rows[offset + index * stride]);
  if (selected.some((row) => !row)) throw new Error('offset/stride selection exceeds inventory');
  writeNew(required('output'), selected.map(englishPayload));
}

function prepareCritic(): void {
  let completed: Array<{ request: LocalRequest; result: LocalResult }>;
  const repairInput = arg('repair-input');
  const repairResults = arg('repair-results');
  if (Boolean(repairInput) !== Boolean(repairResults)) throw new Error('both repair spool arguments are required');
  if (repairInput && repairResults) {
    const repairs = loadCompleted(repairInput, repairResults);
    const repairedIds = new Set(repairs.map(({ request }) => String(request.payload.dsd_entry_id)));
    const requests = readJsonl<LocalRequest>(path.resolve(process.cwd(), required('input')));
    const results = readJsonl<LocalResult>(path.resolve(process.cwd(), required('results')));
    const requestMap = new Map(requests.map((request) => [request.request_id, request]));
    const retained = results.flatMap((result) => {
      const request = requestMap.get(result.request_id);
      if (!request) throw new Error(`${result.request_id}: no matching request`);
      if (repairedIds.has(String(request.payload.dsd_entry_id))) return [];
      const errors = validateLocalResult(result, request);
      if (errors.length || result.state !== 'completed') throw new Error(`${result.request_id}: ${errors.join('; ')}`);
      return [{ request, result }];
    });
    completed = [...retained, ...repairs];
  } else {
    completed = loadCompleted(required('input'), required('results'));
  }
  writeNew(required('output'), completed.map(({ request, result }) => ({
    dsd_entry_id: request.payload.dsd_entry_id,
    headword: (result.output as any).headword,
    part_of_speech: (result.output as any).part_of_speech,
    definition_en: (result.output as any).definition_en,
    example_en: (result.output as any).example_en,
    usage_labels: (result.output as any).usage_labels,
    seed: deterministicSeed(request.payload.dsd_entry_id, result.output_sha256),
  })));
}

function prepareTranslations(): void {
  const selection = arg('selection');
  if (selection) {
    const selected = loadSelectionManifest(selection);
    const payloads = selected.passedEnglish.flatMap(({ request, result }, index) => {
      const output = result.output as any;
      return [
        { dsd_entry_id: request.payload.dsd_entry_id, field: 'definition_en', text: output.definition_en,
          seed: deterministicSeed(request.payload.dsd_entry_id, 'definition_en', output.definition_en) },
        { dsd_entry_id: request.payload.dsd_entry_id, field: 'example_en', text: output.example_en,
          seed: deterministicSeed(request.payload.dsd_entry_id, 'example_en', output.example_en) },
      ];
    });
    writeNew(required('output'), payloads);
    return;
  }
  const completed = loadCompleted(required('input'), required('results'));
  const critics = loadCompleted(required('critic-input'), required('critic-results'));
  const repairInput = arg('repair-input');
  const repairResults = arg('repair-results');
  const repairCriticInput = arg('repair-critic-input');
  const repairCriticResults = arg('repair-critic-results');
  if ([repairInput, repairResults, repairCriticInput, repairCriticResults].some(Boolean) &&
      ![repairInput, repairResults, repairCriticInput, repairCriticResults].every(Boolean)) {
    throw new Error('all four repair spool arguments are required together');
  }
  if (repairInput && repairResults && repairCriticInput && repairCriticResults) {
    const repairs = loadCompleted(repairInput, repairResults);
    const repairCritics = loadCompleted(repairCriticInput, repairCriticResults);
    const repairedIds = new Set(repairs.map(({ request }) => String(request.payload.dsd_entry_id)));
    completed.splice(0, completed.length,
      ...completed.filter(({ request }) => !repairedIds.has(String(request.payload.dsd_entry_id))), ...repairs);
    critics.splice(0, critics.length,
      ...critics.filter(({ request }) => !repairedIds.has(String(request.payload.dsd_entry_id))), ...repairCritics);
  }
  const passedEntries = new Set(critics
    .filter(({ result }) => (result.output as any).decision === 'pass')
    .map(({ request }) => String(request.payload.dsd_entry_id)));
  const payloads = completed
    .filter(({ request }) => passedEntries.has(String(request.payload.dsd_entry_id)))
    .flatMap(({ request, result }) => {
    const output = result.output as any;
    return [
      { dsd_entry_id: request.payload.dsd_entry_id, field: 'definition_en', text: output.definition_en,
        seed: deterministicSeed(request.payload.dsd_entry_id, 'definition_en', output.definition_en) },
      { dsd_entry_id: request.payload.dsd_entry_id, field: 'example_en', text: output.example_en,
        seed: deterministicSeed(request.payload.dsd_entry_id, 'example_en', output.example_en) },
    ];
  });
  writeNew(required('output'), payloads);
}

function prepareRepairs(): void {
  const inventory = loadInventoryFile(path.resolve(process.cwd(), required('inventory')));
  if (inventory.errors.length) throw new Error(`invalid inventory: ${inventory.errors.join('; ')}`);
  const rows = new Map(inventory.rows.map((row) => [row.dsd_entry_id, row]));
  const selectionFile = arg('selection');
  const critics = selectionFile ? loadSelectionManifest(selectionFile).critics
    : loadCompleted(required('critic-input'), required('critic-results'));
  const revision = Number(arg('revision') ?? 1);
  const payloads = critics
    .filter(({ result }) => (result.output as any).decision === 'repair')
    .map(({ request, result }) => {
      const id = String(request.payload.dsd_entry_id);
      const row = rows.get(id);
      if (!row) throw new Error(`${id}: critic entry missing from inventory`);
      return {
        ...englishPayload(row),
        seed: deterministicSeed(id, revision, (result.output as any).reason_codes),
        repair_codes: (result.output as any).reason_codes,
        revision,
      };
    });
  if (!payloads.length) throw new Error('critic produced no repair candidates');
  writeNew(required('output'), payloads);
}

function prepareSchemaRepairs(): void {
  const inventory = loadInventoryFile(path.resolve(process.cwd(), required('inventory')));
  if (inventory.errors.length) throw new Error(`invalid inventory: ${inventory.errors.join('; ')}`);
  const rows = new Map(inventory.rows.map((row) => [row.dsd_entry_id, row]));
  const requests = readJsonl<LocalRequest>(path.resolve(process.cwd(), required('input')));
  const requestMap = new Map(requests.map((request) => [request.request_id, request]));
  const revision = Number(arg('revision') ?? 1);
  const payloads = readJsonl<LocalResult>(path.resolve(process.cwd(), required('results'))).flatMap((result) => {
    const request = requestMap.get(result.request_id);
    if (!request) throw new Error(`${result.request_id}: no matching request`);
    const errors = validateLocalResult(result, request);
    if (!errors.length) return [];
    if (errors.length !== 1 || errors[0] !== 'usage_labels are invalid') {
      throw new Error(`${result.request_id}: non-repairable validation error: ${errors.join('; ')}`);
    }
    const id = String(request.payload.dsd_entry_id);
    const row = rows.get(id);
    if (!row) throw new Error(`${id}: entry missing from inventory`);
    return [{ ...englishPayload(row), seed: deterministicSeed(id, revision, 'USAGE_LABEL_INVALID'),
      repair_codes: ['USAGE_LABEL_INVALID'], revision }];
  });
  if (!payloads.length) throw new Error('no schema-repair candidates');
  writeNew(required('output'), payloads);
}

function prepareLemmaRepairs(): void {
  const selected = loadSelectionManifest(required('selection'));
  const inventory = loadInventoryFile(path.resolve(process.cwd(), required('inventory')));
  if (inventory.errors.length) throw new Error(`invalid inventory: ${inventory.errors.join('; ')}`);
  const rows = new Map(inventory.rows.map((row) => [row.dsd_entry_id, row]));
  const revision = Number(arg('revision') ?? 1);
  const payloads = selected.passedEnglish.flatMap(({ request, result }) => {
    const output = result.output as any;
    const id = String(request.payload.dsd_entry_id);
    const findings = checkExample({ entityId: id, headword: String(output.headword),
      partOfSpeech: String(output.part_of_speech), exampleEn: String(output.example_en),
      exampleVi: 'bản dịch kiểm tra' });
    if (!findings.some((finding) => finding.rule === 'lemma_missing')) return [];
    const row = rows.get(id);
    if (!row) throw new Error(`${id}: entry missing from inventory`);
    return [{ ...englishPayload(row), seed: deterministicSeed(id, revision, 'EXAMPLE_LEMMA_MISSING'),
      repair_codes: ['EXAMPLE_LEMMA_MISSING'], revision }];
  });
  if (!payloads.length) throw new Error('no lemma-repair candidates');
  writeNew(required('output'), payloads);
}

function prepareInventoryCritic(): void {
  const generated = loadCompleted(required('input'), required('results'));
  if (!generated.length || generated.some((value) => value.request.stage !== 'inventory')) {
    throw new Error('reserve inventory expects completed inventory requests only');
  }
  const existing = loadInventoryFile(path.resolve(process.cwd(), required('existing-inventory')));
  if (existing.errors.length) throw new Error(`invalid existing inventory: ${existing.errors.join('; ')}`);
  const seen = new Set(existing.rows.map((row) => normalizeHeadword(row.headword).headwordNormalized));
  const payloads = generated.flatMap(({ request, result }) =>
    ((result.output as any).candidates as any[]).flatMap((candidate) => {
      const normalized = normalizeHeadword(String(candidate.headword));
      if (seen.has(normalized.headwordNormalized)) return [];
      seen.add(normalized.headwordNormalized);
      return [{
        dsd_entry_id: stableDsdEntryId(normalized.headword), headword: normalized.headword,
        part_of_speech: candidate.part_of_speech, rationale: candidate.rationale,
        coverage_cell_id: request.payload.coverage_cell_id, level: request.payload.level,
        register: request.payload.register, topic: request.payload.topic,
        seed: deterministicSeed(normalized.headwordNormalized, candidate.part_of_speech, candidate.rationale),
      }];
    }));
  if (!payloads.length) throw new Error('no unique reserve candidates remain after exclusion');
  writeNew(required('output'), payloads);
}

function csv(value: unknown): string {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function materializeReserve(): void {
  const critics = loadCompleted(required('critic-input'), required('critic-results'));
  const passed = critics.filter(({ result }) => (result.output as any).decision === 'pass');
  if (!passed.length) throw new Error('no reserve candidates passed critic');
  const limit = Number(arg('limit') ?? passed.length);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > passed.length) {
    throw new Error(`--limit must be between 1 and ${passed.length}`);
  }
  const startPriority = Number(arg('start-priority') ?? 51);
  const columns = [
    'dsd_entry_id', 'headword', 'part_of_speech_expectation', 'dsd_priority', 'dsd_band',
    'product_rationale', 'author_contributor_id', 'authored_date', 'inventory_evidence_id', 'declaration_id',
  ];
  const rows = passed.slice(0, limit).map(({ request }, index) => [
    request.payload.dsd_entry_id, request.payload.headword, request.payload.part_of_speech,
    startPriority + index, 'pilot-reserve', request.payload.rationale, 'DSD-G-002', '2026-08-11',
    'EV-DSD-LOCAL-CALIBRATION-050-20260811', 'EV-DSD-CLEAN-ROOM-LOCAL-W0-20260811',
  ]);
  const output = path.resolve(process.cwd(), required('output'));
  if (fs.existsSync(output)) throw new Error(`refusing to overwrite: ${output}`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, [columns, ...rows].map((row) => row.map(csv).join(',')).join('\n') + '\n', { flag: 'wx' });
  console.log(`Wrote ${rows.length} passed reserve inventory row(s): ${output}`);
}

function translationQuality(text: string, source: string): string[] {
  const errors: string[] = [];
  const normalized = text.trim().toLocaleLowerCase();
  if (!normalized) errors.push('EMPTY_TRANSLATION');
  if (normalized === source.trim().toLocaleLowerCase()) errors.push('SOURCE_COPIED');
  if (/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u.test(text)) errors.push('CJK_CONTAMINATION');
  // Vietnamese has legitimate ASCII-only words (for example "mua", "ban",
  // and "con"). Accent absence alone is therefore review metadata, not a
  // deterministic failure.
  return errors;
}

function report(): void {
  const selectionFile = arg('selection');
  const selected = selectionFile ? loadSelectionManifest(selectionFile) : undefined;
  const english = selected?.english ?? loadCompleted(required('english-input'), required('english-results'));
  const critics = selected?.critics ?? loadCompleted(required('critic-input'), required('critic-results'));
  const repairEnglishInput = arg('repair-input');
  const repairEnglishResults = arg('repair-results');
  const repairCriticInput = arg('repair-critic-input');
  const repairCriticResults = arg('repair-critic-results');
  if (!selected && [repairEnglishInput, repairEnglishResults, repairCriticInput, repairCriticResults].every(Boolean)) {
    const repairs = loadCompleted(repairEnglishInput!, repairEnglishResults!);
    const repairedIds = new Set(repairs.map(({ request }) => String(request.payload.dsd_entry_id)));
    english.splice(0, english.length,
      ...english.filter(({ request }) => !repairedIds.has(String(request.payload.dsd_entry_id))), ...repairs);
    critics.splice(0, critics.length,
      ...critics.filter(({ request }) => !repairedIds.has(String(request.payload.dsd_entry_id)),),
      ...loadCompleted(repairCriticInput!, repairCriticResults!));
  } else if (!selected && [repairEnglishInput, repairEnglishResults, repairCriticInput, repairCriticResults].some(Boolean)) {
    throw new Error('all four repair spool arguments are required together');
  }
  const translations = loadCompleted(required('translation-input'), required('translation-results'));
  const decisions = { pass: 0, repair: 0, quarantine: 0 };
  critics.forEach(({ result }) => { decisions[(result.output as any).decision as keyof typeof decisions] += 1; });
  const translationFailures = translations.flatMap(({ request, result }) => {
    const codes = translationQuality(String((result.output as any).translation_vi), String(request.payload.text));
    return codes.length ? [{ request_id: request.request_id, dsd_entry_id: request.payload.dsd_entry_id,
      field: request.payload.field, codes }] : [];
  });
  const passedIds = new Set(critics.filter(({ result }) => (result.output as any).decision === 'pass')
    .map(({ request }) => String(request.payload.dsd_entry_id)));
  const expectedTranslations = passedIds.size * 2;
  const value = {
    report_version: 1,
    english: { total: english.length, schema_valid: english.length },
    critic: { total: critics.length, decisions },
    translation: {
      expected: expectedTranslations, total: translations.length,
      deterministic_quality_pass: translations.length - translationFailures.length,
      deterministic_quality_fail: translationFailures.length,
    },
    complete_entries: translationFailures.length === 0 && translations.length === expectedTranslations
      ? passedIds.size : 0,
    translation_failures: translationFailures,
  };
  writeNew(required('output'), value);
}

if (require.main === module) {
  const command = process.argv[2];
  if (command === 'prepare-english') prepareEnglish();
  else if (command === 'prepare-critic') prepareCritic();
  else if (command === 'prepare-translations') prepareTranslations();
  else if (command === 'prepare-repairs') prepareRepairs();
  else if (command === 'prepare-schema-repairs') prepareSchemaRepairs();
  else if (command === 'prepare-lemma-repairs') prepareLemmaRepairs();
  else if (command === 'prepare-inventory-critic') prepareInventoryCritic();
  else if (command === 'materialize-reserve') materializeReserve();
  else if (command === 'report') report();
  else throw new Error('usage: calibration.ts <prepare-english|prepare-critic|prepare-translations|prepare-repairs|prepare-schema-repairs|prepare-lemma-repairs|prepare-inventory-critic|materialize-reserve|report> ...');
}
