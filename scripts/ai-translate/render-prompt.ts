/**
 * Builds TranslateGemma prompts without reimplementing the model's Jinja template.
 *
 * TranslateGemma's chat template takes non-standard content fields
 * (source_lang_code / target_lang_code). llama.cpp's OpenAI-compatible layer
 * drops them (ggml-org/llama.cpp#19295), and the model then silently translates
 * English to English — output that looks well-formed and is entirely wrong.
 *
 * So we never use /v1/chat/completions. Instead setup/extract-template.py renders
 * the real template once with a sentinel in place of the text and splits on it,
 * producing the prefix/suffix descriptor this module consumes. That keeps the
 * exact bytes the model was trained on without a Jinja interpreter in TypeScript,
 * and the descriptor records which language pair it was generated for so a
 * mismatched or stale one is rejected instead of silently producing en->en.
 */

import * as fs from 'fs';

export const SENTINEL = '__TG_TEXT__';

// Gemma turn markers. Source text containing one would let a definition escape
// its own user turn and impersonate the model turn.
const TURN_MARKER_RE = /<(?:start|end)_of_turn>/;

export interface PromptDescriptor {
  sourceLangCode: string;
  targetLangCode: string;
  prefix: string;
  suffix: string;
}

export interface ExpectedPair {
  source: string;
  target: string;
}

export function parseDescriptor(raw: unknown, expected: ExpectedPair): PromptDescriptor {
  if (!raw || typeof raw !== 'object') {
    throw new Error('prompt descriptor is not an object');
  }

  const d = raw as Record<string, unknown>;

  for (const field of ['sourceLangCode', 'targetLangCode', 'prefix', 'suffix']) {
    const value = d[field];
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`prompt descriptor has a missing or empty ${field}`);
    }
  }

  const descriptor: PromptDescriptor = {
    sourceLangCode: d.sourceLangCode as string,
    targetLangCode: d.targetLangCode as string,
    prefix: d.prefix as string,
    suffix: d.suffix as string,
  };

  if (descriptor.sourceLangCode !== expected.source) {
    throw new Error(
      `prompt descriptor source is '${descriptor.sourceLangCode}', expected '${expected.source}'`,
    );
  }

  if (descriptor.targetLangCode !== expected.target) {
    throw new Error(
      `prompt descriptor target is '${descriptor.targetLangCode}', expected '${expected.target}'`,
    );
  }

  if (descriptor.prefix.includes(SENTINEL) || descriptor.suffix.includes(SENTINEL)) {
    throw new Error(`prompt descriptor still contains the extractor sentinel ${SENTINEL}`);
  }

  return descriptor;
}

export function loadDescriptorFile(filePath: string, expected: ExpectedPair): PromptDescriptor {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `no prompt descriptor at ${filePath}. Generate it with:\n` +
        '  python3 setup/extract-template.py --source en --target vi',
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error: any) {
    throw new Error(`prompt descriptor at ${filePath} is not valid JSON: ${error.message}`);
  }

  return parseDescriptor(raw, expected);
}

export function renderPrompt(descriptor: PromptDescriptor, text: string): string {
  if (!text || !text.trim()) {
    throw new Error('refusing to render a prompt for empty source text');
  }

  if (TURN_MARKER_RE.test(text)) {
    throw new Error('source text contains a turn marker and cannot be safely templated');
  }

  return descriptor.prefix + text + descriptor.suffix;
}
