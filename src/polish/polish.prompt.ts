import OpenAI from "openai";
import { PATTERNS, patternKind } from "./polish.catalog";
import {
  CorrectionKind,
  PolishCorrection,
  PolishResult,
  PolishTone,
} from "./polish.types";

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

const MAX_EXPLANATION_LENGTH = 140;
const KINDS: CorrectionKind[] = ["grammar", "natural", "tone"];

export class PolishParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolishParseError";
  }
}

export function buildPolishMessages(
  draft: string,
  tone: PolishTone,
  retryNote?: string,
): ChatMessage[] {
  const codes = PATTERNS.map(
    (p) => `  - ${p.code} (${p.kind}): ${p.gloss}, e.g. ${p.example}`,
  ).join("\n");
  const system = [
    `You polish a Vietnamese speaker's English workplace writing. Target tone: ${tone}.`,
    "Tone guide: neutral = how a competent native colleague writes; casual = friendly chat; formal = polished business email but not legalistic.",
    'Return only JSON: {"finalText": string, "corrections": [{"kind": string, "patternCode": string, "wrong": string, "right": string, "explanationVi": string, "minor": boolean}]}.',
    'Example correction: {"kind":"grammar","patternCode":"redundant_preposition","wrong":"discuss about the issue","right":"discuss the issue","explanationVi":"Động từ discuss không cần giới từ about.","minor":false}',
    '- "kind" is exactly one of: grammar | natural | tone. It is never a pattern code.',
    '- "wrong" must be an exact substring of the draft and "right" an exact substring of finalText.',
    `- "patternCode" must be one of:\n${codes}`,
    '- Use "other" only as a last resort, when none of the codes above fits (kind is then one of grammar, natural, tone).',
    "- Preserve names, numbers, dates, URLs, emails, @mentions, commitments and technical terms exactly.",
    '- "explanationVi" is one plain Vietnamese line, no jargon.',
    '- "minor" is true only for trivial article, punctuation or capitalization fixes.',
    "- If the draft is already good, return it unchanged with no corrections.",
    "- Keep line breaks.",
  ].join("\n");

  const messages: ChatMessage[] = [{ role: "system", content: system }];
  if (retryNote) messages.push({ role: "system", content: retryNote });
  messages.push({ role: "user", content: draft });
  return messages;
}

export function parsePolishResponse(
  raw: string,
  draft: string,
  tone: PolishTone,
): PolishResult {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new PolishParseError("Response is not valid JSON");
  }
  if (typeof data?.finalText !== "string" || !data.finalText.trim()) {
    throw new PolishParseError("Missing finalText");
  }
  if (!Array.isArray(data.corrections)) {
    throw new PolishParseError("corrections is not an array");
  }
  const finalText: string = data.finalText;

  const corrections: PolishCorrection[] = [];
  for (const c of data.corrections) {
    if (
      typeof c?.wrong !== "string" ||
      typeof c?.right !== "string" ||
      !c.wrong ||
      !draft.includes(c.wrong) ||
      !finalText.includes(c.right)
    ) {
      continue;
    }
    const code = [c.patternCode, c.kind].find(
      (v) => typeof v === "string" && patternKind(v),
    );
    const known = code ? patternKind(code) : undefined;
    const kind: CorrectionKind =
      known ?? (KINDS.includes(c.kind) ? c.kind : "grammar");
    corrections.push({
      kind,
      patternCode: known ? code : "other",
      wrong: c.wrong,
      right: c.right,
      explanationVi: String(c.explanationVi ?? "").slice(
        0,
        MAX_EXPLANATION_LENGTH,
      ),
      minor: c.minor === true,
    });
  }
  return { tone, finalText, corrections };
}

export function protectedTokens(text: string): string[] {
  const tokens = new Set<string>();
  let rest = text;
  const take = (re: RegExp, clean = (s: string) => s) => {
    rest = rest.replace(re, (m) => {
      tokens.add(clean(m));
      return " ";
    });
  };
  take(/https?:\/\/\S+/g, (s) => s.replace(/[.,;:!?)\]}'"]+$/, ""));
  take(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g);
  take(/@\w+/g);
  take(/\d[\d.,:/-]*\d|\d/g);
  return [...tokens];
}

export function missingProtectedTokens(
  draft: string,
  finalText: string,
): string[] {
  return protectedTokens(draft).filter((t) => !finalText.includes(t));
}
