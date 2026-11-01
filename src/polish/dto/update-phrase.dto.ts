import { IsIn } from 'class-validator';
import { SITUATIONS } from '../polish.catalog';

export class UpdatePhraseDto {
  @IsIn(SITUATIONS.map((s) => s.code))
  situationCode: string;
}
