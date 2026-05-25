export class SubmitAttemptResponseDto {
  verdict: 'correct' | 'partial' | 'incorrect';
  score: number;
  feedback: string;
  suggestedAnswer: string;
}
