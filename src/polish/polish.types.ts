export type PolishTone = "casual" | "neutral" | "formal";
export type CorrectionKind = "grammar" | "natural" | "tone";

export interface PolishCorrection {
  kind: CorrectionKind;
  patternCode: string;
  wrong: string;
  right: string;
  explanationVi: string;
  minor: boolean;
}

export interface PolishResult {
  tone: PolishTone;
  finalText: string;
  corrections: PolishCorrection[];
}
