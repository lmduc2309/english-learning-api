import { IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class SavePhraseDto {
  @IsString()
  @Length(1, 200)
  text: string;

  // Longer sentences are truncated to 1000 by PolishService, not rejected.
  @IsString()
  @Length(1, 6000)
  sourceSentence: string;

  @IsOptional()
  @IsUUID()
  sessionId?: string;
}
