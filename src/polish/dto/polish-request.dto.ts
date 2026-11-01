import { Transform } from 'class-transformer';
import { IsIn, IsString, Length } from 'class-validator';
import { PolishTone } from '../polish.types';

export class PolishRequestDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 3000)
  text: string;

  @IsIn(['casual', 'neutral', 'formal'])
  tone: PolishTone;
}
