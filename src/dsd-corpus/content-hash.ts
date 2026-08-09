import * as crypto from 'crypto';

export const CONTENT_HASH_VERSION = 1;

export type ContentKind =
  | 'definition'
  | 'translation'
  | 'example'
  | 'pronunciation'
  | 'relation';

export function normalizeContent(value: string): string {
  return (value ?? '')
    .normalize('NFC')
    .replace(/[‘’ʼ′]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonical(child)]),
    );
  }
  return typeof value === 'string' ? normalizeContent(value) : value;
}

export function contentHash(
  kind: ContentKind,
  fields: Record<string, unknown>,
  version = CONTENT_HASH_VERSION,
): string {
  const payload = `dsd.${kind}.v${version}\0${JSON.stringify(canonical(fields))}`;
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

export function definitionHash(input: {
  definitionEn: string;
  partOfSpeech: string;
  usageLabels: string[];
}): string {
  return contentHash('definition', {
    definitionEn: input.definitionEn,
    partOfSpeech: input.partOfSpeech,
    usageLabels: [...(input.usageLabels ?? [])].map(normalizeContent).sort(),
  });
}

export function translationHash(input: { locale: string; text: string }): string {
  return contentHash('translation', input);
}

export function exampleHash(input: { exampleEn: string; exampleVi: string }): string {
  return contentHash('example', input);
}

export function pronunciationHash(input: { accent: string; ipa: string }): string {
  return contentHash('pronunciation', input);
}

export function relationHash(input: {
  fromSenseId: string;
  toSenseId: string;
  relationType: string;
}): string {
  return contentHash('relation', {
    from: input.fromSenseId,
    to: input.toSenseId,
    type: input.relationType,
  });
}
