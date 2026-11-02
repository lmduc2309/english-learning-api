import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsString, Length, MaxLength, ValidateNested } from 'class-validator';
import { PolishTone } from '../polish.types';
import { PolishCorrectionDto } from './polish-correction.dto';

export class SaveSessionDto {
  @IsString()
  @MaxLength(80)
  sourceApp: string;

  @IsIn(['casual', 'neutral', 'formal'])
  tone: PolishTone;

  @IsString()
  @Length(1, 3000)
  rawText: string;

  @IsString()
  @Length(1, 6000)
  editedText: string;

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PolishCorrectionDto)
  corrections: PolishCorrectionDto[];
}
