import { CorrectionKind } from "./polish.types";

export const PATTERNS: ReadonlyArray<{
  code: string;
  kind: CorrectionKind;
  labelVi: string;
  gloss: string;
  example: string;
}> = [
  {
    code: "article",
    kind: "grammar",
    labelVi: "Mạo từ (a/an/the)",
    gloss: "missing, extra or wrong a/an/the",
    example: '"send me report" → "send me the report"',
  },
  {
    code: "plural_s",
    kind: "grammar",
    labelVi: "Danh từ số nhiều (-s)",
    gloss: "plural noun missing -s",
    example: '"two bug" → "two bugs"',
  },
  {
    code: "subject_verb_agreement",
    kind: "grammar",
    labelVi: "Hòa hợp chủ ngữ - động từ",
    gloss: "verb does not match its subject",
    example: '"He go to office" → "He goes to the office"',
  },
  {
    code: "verb_tense",
    kind: "grammar",
    labelVi: "Thì của động từ",
    gloss: "wrong tense for the time referred to",
    example: '"Yesterday I fix it" → "Yesterday I fixed it"',
  },
  {
    code: "verb_form",
    kind: "grammar",
    labelVi: "Dạng của động từ",
    gloss: "wrong verb form (-ing, to-infinitive, participle)",
    example: '"I look forward to hear from you" → "I look forward to hearing from you"',
  },
  {
    code: "passive_voice",
    kind: "grammar",
    labelVi: "Câu bị động",
    gloss: "passive voice missing or wrongly built",
    example: '"The bug was fix" → "The bug was fixed"',
  },
  {
    code: "preposition",
    kind: "grammar",
    labelVi: "Giới từ",
    gloss: "wrong preposition",
    example: '"good in English" → "good at English"',
  },
  {
    code: "redundant_preposition",
    kind: "grammar",
    labelVi: "Giới từ thừa",
    gloss: "preposition added where the verb takes none",
    example: '"discuss about the issue" → "discuss the issue"',
  },
  {
    code: "countable_uncountable",
    kind: "grammar",
    labelVi: "Danh từ đếm được / không đếm được",
    gloss: "uncountable noun treated as countable or vice versa",
    example: '"many informations" → "a lot of information"',
  },
  {
    code: "word_order",
    kind: "grammar",
    labelVi: "Trật tự từ",
    gloss: "words in the wrong order",
    example: '"I not yet finished" → "I have not finished yet"',
  },
  {
    code: "missing_subject",
    kind: "grammar",
    labelVi: "Thiếu chủ ngữ",
    gloss: "sentence has no subject",
    example: '"Is ready for review" → "It is ready for review"',
  },
  {
    code: "spelling",
    kind: "grammar",
    labelVi: "Chính tả",
    gloss: "misspelled word",
    example: '"recieve" → "receive"',
  },
  {
    code: "punctuation_capitalization",
    kind: "grammar",
    labelVi: "Dấu câu và viết hoa",
    gloss: "wrong punctuation or capital letters",
    example: '"hi team,thanks" → "Hi team, thanks"',
  },
  {
    code: "run_on_sentence",
    kind: "grammar",
    labelVi: "Câu quá dài, thiếu ngắt",
    gloss: "several sentences joined without a break",
    example: '"I fixed it please check" → "I fixed it. Please check."',
  },
  {
    code: "literal_translation",
    kind: "natural",
    labelVi: "Dịch word-by-word từ tiếng Việt",
    gloss: "word-for-word from Vietnamese, unnatural in English",
    example: '"I want to inform that" → "Just a heads-up:"',
  },
  {
    code: "word_choice",
    kind: "natural",
    labelVi: "Chọn từ chưa chuẩn",
    gloss: "a real word, but not the right one here",
    example: '"I will revert you soon" → "I will get back to you soon"',
  },
  {
    code: "unnatural_phrase",
    kind: "natural",
    labelVi: "Cách diễn đạt không tự nhiên",
    gloss: "grammatical but no native would say it",
    example: '"Please kindly check it for me" → "Could you take a look?"',
  },
  {
    code: "wordiness",
    kind: "natural",
    labelVi: "Dài dòng",
    gloss: "more words than needed",
    example: '"at this point in time" → "now"',
  },
  {
    code: "too_direct",
    kind: "tone",
    labelVi: "Quá thẳng",
    gloss: "sounds blunt or demanding",
    example: '"Send me the file now" → "Could you send me the file?"',
  },
  {
    code: "too_informal",
    kind: "tone",
    labelVi: "Quá thân mật",
    gloss: "too casual for the target tone",
    example: '"gonna" → "going to"',
  },
  {
    code: "too_formal",
    kind: "tone",
    labelVi: "Quá trang trọng",
    gloss: "stiff or legalistic for the target tone",
    example: '"Kindly be informed that" → "Just so you know,"',
  },
  {
    code: "missing_softener",
    kind: "tone",
    labelVi: "Thiếu từ làm mềm câu",
    gloss: "request or disagreement lacks a softening word",
    example: '"You are wrong" → "I think there might be a mistake"',
  },
  {
    code: "abrupt_closing",
    kind: "tone",
    labelVi: "Kết thư cụt lủn",
    gloss: "message ends without a polite closing",
    example: '"Do it." → "Thanks in advance!"',
  },
];

export const SITUATIONS: ReadonlyArray<{ code: string; labelVi: string }> = [
  { code: "report_delay", labelVi: "Báo trễ tiến độ" },
  { code: "status_update", labelVi: "Cập nhật tình hình" },
  { code: "clarify_requirement", labelVi: "Hỏi rõ yêu cầu" },
  { code: "decline_politely", labelVi: "Từ chối lịch sự" },
  { code: "request_action", labelVi: "Nhờ ai đó làm việc" },
  { code: "apologize", labelVi: "Xin lỗi" },
  { code: "follow_up", labelVi: "Nhắc lại / follow up" },
  { code: "give_feedback", labelVi: "Góp ý" },
  { code: "schedule_meeting", labelVi: "Hẹn lịch họp" },
  { code: "thanks_closing", labelVi: "Cảm ơn và kết thư" },
  { code: "other", labelVi: "Khác" },
];

export function patternKind(code: string): CorrectionKind | undefined {
  return PATTERNS.find((p) => p.code === code)?.kind;
}
