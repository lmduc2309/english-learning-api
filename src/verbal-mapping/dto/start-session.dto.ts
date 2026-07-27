import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsString,
} from 'class-validator';

export class StartSessionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @IsString({ each: true })
  words: string[];

  @IsInt()
  @IsIn([5, 10, 15, 20])
  numSentences: number;

  @IsIn(['beginner', 'intermediate', 'advanced'])
  difficulty: 'beginner' | 'intermediate' | 'advanced';
}
