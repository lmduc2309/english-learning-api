import type { TranslationItem, ExampleItem, OpenRouterMessage } from './types';

const SYSTEM_PROMPT = `You are an expert English-Vietnamese translator specializing in dictionary definitions.
Rules:
- Translate accurately and naturally into Vietnamese
- Keep translations concise — dictionary style, not literary
- Preserve part-of-speech nuance (noun vs verb meanings)
- For technical/specialized terms, use the accepted Vietnamese equivalent
- Return ONLY valid JSON, no extra text
- The output array MUST have the same number of items and same IDs as the input`;

export function buildDefinitionPrompt(items: TranslationItem[]): OpenRouterMessage[] {
  const input = items.map((item) => ({
    id: item.id,
    word: item.word,
    pos: item.pos,
    en: item.en,
  }));

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Translate these English definitions to Vietnamese. Return a JSON object with a "results" array.

Input:
${JSON.stringify(input, null, 2)}

Return format:
{"results": [{"id": <same_id>, "vi": "<Vietnamese translation>"}, ...]}`,
    },
  ];
}

export function buildExamplePrompt(items: ExampleItem[]): OpenRouterMessage[] {
  const input = items.map((item) => ({
    id: item.id,
    word: item.word,
    en: item.en,
  }));

  return [
    {
      role: 'system',
      content: `You are an expert English-Vietnamese translator. Translate example sentences naturally into Vietnamese.
Rules:
- Translate naturally, not word-by-word
- Preserve the tone and register of the original
- Return ONLY valid JSON, no extra text
- The output array MUST have the same number of items and same IDs as the input`,
    },
    {
      role: 'user',
      content: `Translate these English example sentences to Vietnamese. Return a JSON object with a "results" array.

Input:
${JSON.stringify(input, null, 2)}

Return format:
{"results": [{"id": <same_id>, "vi": "<Vietnamese translation>"}, ...]}`,
    },
  ];
}
