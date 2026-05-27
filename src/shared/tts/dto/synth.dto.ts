import { IsNotEmpty, IsString } from 'class-validator';

export class SynthDto {
  @IsString()
  @IsNotEmpty()
  text: string;

  @IsString()
  @IsNotEmpty()
  voiceId: string;
}
