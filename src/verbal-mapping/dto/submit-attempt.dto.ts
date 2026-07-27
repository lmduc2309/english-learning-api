import { IsInt, IsString, Min } from 'class-validator';

export class SubmitAttemptDto {
  @IsInt()
  @Min(0)
  sentenceIndex: number;

  @IsString()
  transcript: string;
}
