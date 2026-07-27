export class FinishSessionResponseDto {
  totalScore: number;
  rounds: number;
  perWord: Array<{ word: string; attempts: number; avgScore: number }>;
}
