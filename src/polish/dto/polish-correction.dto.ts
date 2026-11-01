import { IsBoolean, IsIn, IsString, Length, MaxLength } from 'class-validator';
import { CorrectionKind } from '../polish.types';

export class PolishCorrectionDto {
  @IsIn(['grammar', 'natural', 'tone'])
  kind: CorrectionKind;

  @IsString()
  @MaxLength(40)
  patternCode: string;

  @IsString()
  @Length(1, 3000)
  wrong: string;

  @IsString()
  @MaxLength(3000)
  right: string;

  @IsString()
  @MaxLength(300)
  explanationVi: string;

  @IsBoolean()
  minor: boolean;
}
