import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class StartSessionDto {
  @IsArray()
  @ArrayMinSize(0)
  @ArrayMaxSize(30)
  @IsString({ each: true })
  words: string[];

  @IsOptional()
  @IsUUID()
  wordListId?: string;

  @IsInt()
  @IsIn([5, 10, 15, 20])
  numSentences: number;

  @IsIn(['beginner', 'intermediate', 'advanced'])
  difficulty: 'beginner' | 'intermediate' | 'advanced';
}
