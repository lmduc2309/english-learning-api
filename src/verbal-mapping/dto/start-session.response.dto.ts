export class StartSessionResponseDto {
  sessionId: string;
  sentences: Array<{ index: number; vi: string; words: string[] }>;
}
