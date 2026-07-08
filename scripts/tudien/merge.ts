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
    if (enPos === null) continue; // unknown/unmappable label → skip, don't pollute primary
    const targets = byPos.get(enPos) || [];
    if (targets.length === 0) {
      push(primary, block.senses[0]); // mapped POS not present in DB → primary fallback
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
