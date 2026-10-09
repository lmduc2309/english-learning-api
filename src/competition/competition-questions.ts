import {
  CompetitionQuestion,
  CompetitionQuestionMode,
  CompetitionQuestionType,
  CompetitionGameMode,
} from './entities/competition-room.entity';

export function makeCompetitionQuestionRequests(
  words: string[],
  mode: CompetitionQuestionMode,
) {
  return words.map((word, index) => ({
    word,
    type: questionTypeAt(index, mode),
  }));
}

export function inferCompetitionQuestionMode(
  questions: CompetitionQuestion[],
): CompetitionQuestionMode {
  const types = new Set(questions.map((question) => question.type ?? 'recall'));
  if (types.size > 1) return 'mixed';
  return types.values().next().value ?? 'recall';
}

export function inferCompetitionGameMode(questions: CompetitionQuestion[]): CompetitionGameMode {
  return questions[0]?.gameMode ?? 'typed';
}

export const PARAGRAPH_RACE_SECONDS = 45;

/** Points for an answer; `remainingRatio` is the share of the round's time still left (0–1). */
export function competitionPoints(
  gameMode: CompetitionGameMode,
  correct: boolean,
  remainingRatio: number,
): number {
  if (!correct) return 0;
  const [base, speedBonus] = gameMode === 'paragraph-race' ? [500, 500] : [700, 300];
  return base + Math.round(speedBonus * remainingRatio);
}

export function makeParagraphWordSets(words: string[], count = 30): string[][] {
  let cursor = 0;
  return Array.from({ length: count }, (_, index) => {
    const wordCount = index % 3 === 2 ? 5 : 4;
    return Array.from({ length: wordCount }, () => {
      const word = words[cursor % words.length];
      cursor += 1;
      return word;
    });
  });
}

/** Parses a host-written paragraph where each answer is wrapped in [brackets]. */
export function parseManualParagraph(
  text: string,
): { prompt: string; answers: string[] } | { error: string } {
  const source = text.trim();
  if (source.length > 700) return { error: 'is longer than 700 characters' };
  const answers: string[] = [];
  const prompt = source.replace(/\[([^[\]]*)\]/g, (_, word: string) => {
    answers.push(word.trim());
    return `[[${answers.length}]]`;
  });
  if (answers.some((answer) => !answer) || /[[\]]/.test(prompt.replace(/\[\[\d+\]\]/g, ''))) {
    return { error: 'has an empty or unclosed [ ]' };
  }
  if (answers.length < 2 || answers.length > 6) return { error: 'needs 2 to 6 words in [brackets]' };
  if (new Set(answers.map((answer) => answer.toLocaleLowerCase())).size !== answers.length) {
    return { error: 'uses the same word twice' };
  }
  return { prompt, answers };
}

export function parseParagraphAnswer(value: string): string[] | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || !parsed.every((word) => typeof word === 'string')) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function paragraphAnswersMatch(value: string, expected: string[]): boolean {
  const parsed = parseParagraphAnswer(value);
  if (parsed?.length !== expected.length) return false;
  return parsed.every((word, index) => normalize(word) === normalize(expected[index]));
}

function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function questionTypeAt(
  index: number,
  mode: CompetitionQuestionMode,
): CompetitionQuestionType {
  if (mode !== 'mixed') return mode;
  return index % 2 === 0 ? 'recall' : 'fill-blank';
}
