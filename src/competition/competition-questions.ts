import {
  CompetitionQuestion,
  CompetitionQuestionMode,
  CompetitionQuestionType,
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

function questionTypeAt(
  index: number,
  mode: CompetitionQuestionMode,
): CompetitionQuestionType {
  if (mode !== 'mixed') return mode;
  return index % 2 === 0 ? 'recall' : 'fill-blank';
}
