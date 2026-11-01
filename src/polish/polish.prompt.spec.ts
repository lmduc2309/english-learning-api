import { PATTERNS } from "./polish.catalog";
import {
  buildPolishMessages,
  missingProtectedTokens,
  parsePolishResponse,
  PolishParseError,
  protectedTokens,
} from "./polish.prompt";

const draft = "He go to office. Please send me report.";
const finalText = "He goes to the office. Please send me the report.";

const raw = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    finalText,
    corrections: [
      {
        kind: "grammar",
        patternCode: "subject_verb_agreement",
        wrong: "He go",
        right: "He goes",
        explanationVi: "Chủ ngữ số ít cần động từ thêm s.",
        minor: false,
      },
    ],
    ...over,
  });

describe("buildPolishMessages", () => {
  it("puts all pattern codes and tone in system, draft in user", () => {
    const messages = buildPolishMessages("Hi", "formal");
    const system = String(messages[0].content);
    for (const p of PATTERNS) expect(system).toContain(p.code);
    expect(system).toContain("formal");
    expect(messages[messages.length - 1].role).toBe("user");
    expect(String(messages[messages.length - 1].content)).toContain("Hi");
  });

  it("glosses every pattern code with an example", () => {
    const system = String(buildPolishMessages("Hi", "neutral")[0].content);
    for (const p of PATTERNS) {
      expect(p.gloss).toBeTruthy();
      expect(p.example).toContain("→");
      expect(system).toContain(`${p.code} (${p.kind}): ${p.gloss}, e.g. ${p.example}`);
    }
    expect(system).toContain(
      '"discuss about the issue" → "discuss the issue"',
    );
    expect(system).toContain('"I want to inform that" → "Just a heads-up:"');
  });

  it("tells the model to use other only as a last resort", () => {
    const system = String(buildPolishMessages("Hi", "neutral")[0].content);
    expect(system).toContain('Use "other" only as a last resort');
  });

  it("states the field schema with a concrete example", () => {
    const system = String(buildPolishMessages("Hi", "neutral")[0].content);
    expect(system).toContain(
      '{"kind":"grammar","patternCode":"redundant_preposition","wrong":"discuss about the issue","right":"discuss the issue"',
    );
    expect(system).toContain('"kind" is exactly one of: grammar | natural | tone');
  });

  it("includes the retry note when given", () => {
    const messages = buildPolishMessages("Hi", "neutral", "keep @Lan");
    expect(messages.map((m) => String(m.content)).join("\n")).toContain(
      "keep @Lan",
    );
  });
});

describe("parsePolishResponse", () => {
  it("returns valid results intact", () => {
    const r = parsePolishResponse(raw(), draft, "neutral");
    expect(r.tone).toBe("neutral");
    expect(r.finalText).toBe(finalText);
    expect(r.corrections).toHaveLength(1);
    expect(r.corrections[0].wrong).toBe("He go");
  });

  it("maps unknown patternCode to other", () => {
    const c = JSON.parse(raw()).corrections[0];
    const r = parsePolishResponse(
      raw({ corrections: [{ ...c, patternCode: "foo" }] }),
      draft,
      "neutral",
    );
    expect(r.corrections[0].patternCode).toBe("other");
  });

  it("drops unverifiable corrections", () => {
    const c = JSON.parse(raw()).corrections[0];
    const r = parsePolishResponse(
      raw({
        corrections: [
          { ...c, wrong: "nope" },
          { ...c, right: "nope" },
        ],
      }),
      draft,
      "neutral",
    );
    expect(r.corrections).toEqual([]);
  });

  it("takes kind from the catalog for known codes", () => {
    const c = JSON.parse(raw()).corrections[0];
    const r = parsePolishResponse(
      raw({
        corrections: [{ ...c, kind: "tone", patternCode: "passive_voice" }],
      }),
      draft,
      "neutral",
    );
    expect(r.corrections[0].kind).toBe("grammar");
  });

  it("uses kind as the code when patternCode is not a known code", () => {
    const c = JSON.parse(raw()).corrections[0];
    const r = parsePolishResponse(
      raw({
        corrections: [{ ...c, kind: "passive_voice", patternCode: "grammar" }],
      }),
      draft,
      "neutral",
    );
    expect(r.corrections[0].patternCode).toBe("passive_voice");
    expect(r.corrections[0].kind).toBe("grammar");
  });

  it("truncates explanationVi to 140 chars", () => {
    const c = JSON.parse(raw()).corrections[0];
    const r = parsePolishResponse(
      raw({ corrections: [{ ...c, explanationVi: "a".repeat(200) }] }),
      draft,
      "neutral",
    );
    expect(r.corrections[0].explanationVi).toHaveLength(140);
  });

  it.each([
    ["non-JSON", "not json"],
    ["missing finalText", JSON.stringify({ corrections: [] })],
    ["empty finalText", raw({ finalText: "  " })],
    ["corrections not array", raw({ corrections: "x" })],
  ])("throws PolishParseError on %s", (_n, input) => {
    expect(() => parsePolishResponse(input, draft, "neutral")).toThrow(
      PolishParseError,
    );
  });

  it("parses JSON in a code fence", () => {
    const r = parsePolishResponse(
      "```json\n" + raw() + "\n```",
      draft,
      "casual",
    );
    expect(r.finalText).toBe(finalText);
    expect(r.tone).toBe("casual");
  });
});

describe("protected tokens", () => {
  const text = "ship v2.3 on 14/11, see https://x.io/a, mail a@b.co, cc @Lan";

  it("extracts urls, emails, mentions and numbers", () => {
    const t = protectedTokens(text);
    for (const x of ["2.3", "14/11", "https://x.io/a", "a@b.co", "@Lan"])
      expect(t).toContain(x);
  });

  it("reports tokens missing from the final text", () => {
    expect(missingProtectedTokens(text, "ship v2.3 on 14/11, cc @Lan")).toEqual(
      expect.arrayContaining(["https://x.io/a", "a@b.co"]),
    );
    expect(missingProtectedTokens(text, text)).toEqual([]);
  });
});
