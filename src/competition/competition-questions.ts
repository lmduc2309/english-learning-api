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
