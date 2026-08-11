import * as fs from 'fs';
import * as path from 'path';
import type { CompletedLocal } from './assemble';
import { LocalRequest, LocalResult, readJsonl, validateLocalResult } from './protocol';

interface SpoolRef { input: string; results: string }
export interface SelectionManifest {
  version: 1;
  english: SpoolRef[];
  critics: SpoolRef[];
}

function id(value: CompletedLocal): string {
  return String(value.request.payload.dsd_entry_id ?? '');
}

function load(ref: SpoolRef, allowInvalidUsageLabels: boolean): CompletedLocal[] {
  const requests = readJsonl<LocalRequest>(path.resolve(process.cwd(), ref.input));
  const requestMap = new Map(requests.map((request) => [request.request_id, request]));
  const seen = new Set<string>();
  return readJsonl<LocalResult>(path.resolve(process.cwd(), ref.results)).flatMap((result) => {
    const request = requestMap.get(result.request_id);
    if (!request) throw new Error(`${result.request_id}: no matching request`);
    seen.add(result.request_id);
    const errors = validateLocalResult(result, request);
    if (allowInvalidUsageLabels && errors.length === 1 && errors[0] === 'usage_labels are invalid') return [];
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
  manifest.critics.flatMap((ref) => load(ref, false)).forEach((value) => criticMap.set(id(value), value));
  const english = [...englishMap.values()].sort((a, b) => id(a).localeCompare(id(b)));
  const critics = [...criticMap.values()].sort((a, b) => id(a).localeCompare(id(b)));
  const passedEnglish = english.filter((value) => {
    const critic = criticMap.get(id(value));
    if (!critic) throw new Error(`${id(value)}: selected English has no critic decision`);
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
