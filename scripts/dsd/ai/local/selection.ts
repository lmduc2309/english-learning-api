import * as fs from 'fs';
import * as path from 'path';
import type { CompletedLocal } from './assemble';
import { LocalRequest, LocalResult, readJsonl, validateLocalResult } from './protocol';

interface SpoolRef { input: string; results: string }
export interface SelectionManifest {
  version: 1;
  english: SpoolRef[];
  critics: SpoolRef[];
  include_entry_ids?: string[];
}

function id(value: CompletedLocal): string {
  return String(value.request.payload.dsd_entry_id ?? '');
}

function load(ref: SpoolRef, allowInvalidUsageLabels: boolean, skipInvalid = false): CompletedLocal[] {
  const requests = readJsonl<LocalRequest>(path.resolve(process.cwd(), ref.input));
  const requestMap = new Map(requests.map((request) => [request.request_id, request]));
  const seen = new Set<string>();
  return readJsonl<LocalResult>(path.resolve(process.cwd(), ref.results)).flatMap((result) => {
    const request = requestMap.get(result.request_id);
    if (!request) throw new Error(`${result.request_id}: no matching request`);
    seen.add(result.request_id);
    const errors = validateLocalResult(result, request);
    if (allowInvalidUsageLabels && errors.length === 1 && errors[0] === 'usage_labels are invalid') return [];
    if (skipInvalid && (errors.length || result.state !== 'completed')) return [];
    if (errors.length || result.state !== 'completed') throw new Error(`${result.request_id}: ${errors.join('; ')}`);
    return [{ request, result }];
  }).concat(seen.size === requests.length ? [] : (() => { throw new Error(`${ref.results}: incomplete spool`); })());
}

export function loadSelectionManifest(file: string): {
  english: CompletedLocal[];
  critics: CompletedLocal[];
  passedEnglish: CompletedLocal[];
} {
  const manifest = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), file), 'utf8')) as SelectionManifest;
  if (manifest.version !== 1 || !Array.isArray(manifest.english) || !Array.isArray(manifest.critics)) {
    throw new Error('invalid selection manifest');
  }
  const englishMap = new Map<string, CompletedLocal>();
  manifest.english.flatMap((ref) => load(ref, true)).forEach((value) => englishMap.set(id(value), value));
  const criticMap = new Map<string, CompletedLocal>();
  // Invalid critic records are immutable evidence but can never participate in
  // selection. Excluding them is fail-closed; they remain visible in reports.
  manifest.critics.flatMap((ref) => load(ref, false, true)).forEach((value) => criticMap.set(id(value), value));
  const include = manifest.include_entry_ids ? new Set(manifest.include_entry_ids) : undefined;
  if (include && include.size !== manifest.include_entry_ids!.length) {
    throw new Error('selection manifest contains duplicate include_entry_ids');
  }
  if (include) {
    for (const entryId of include) {
      if (!englishMap.has(entryId) || !criticMap.has(entryId)) {
        throw new Error(`${entryId}: included entry lacks English or critic evidence`);
      }
    }
  }
  const english = [...englishMap.values()].filter((value) => !include || include.has(id(value)))
    .sort((a, b) => id(a).localeCompare(id(b)));
  const critics = [...criticMap.values()].filter((value) => !include || include.has(id(value)))
    .sort((a, b) => id(a).localeCompare(id(b)));
  const passedEnglish = english.filter((value) => {
    const critic = criticMap.get(id(value));
    if (!critic) return false;
    const output = value.result.output as any;
    const payload = critic.request.payload;
    for (const field of ['headword', 'part_of_speech', 'definition_en', 'example_en', 'usage_labels']) {
      if (JSON.stringify(payload[field]) !== JSON.stringify(output[field])) {
        throw new Error(`${id(value)}: critic is not bound to selected English field ${field}`);
      }
    }
    return (critic.result.output as any).decision === 'pass';
  });
  return { english, critics, passedEnglish };
}
