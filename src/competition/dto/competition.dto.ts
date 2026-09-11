import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CompetitionQuestionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  prompt: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  answer: string;

  @IsString()
  @MaxLength(180)
  hint: string;
}

export class CreateCompetitionRoomDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;

  @IsString()
  @MinLength(1)
  @MaxLength(32)
  hostName: string;

  @IsInt()
  @Min(10)
  @Max(60)
  secondsPerQuestion: number;

  @IsArray()
  @ArrayMinSize(3)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => CompetitionQuestionDto)
  questions: CompetitionQuestionDto[];
}

export class JoinCompetitionRoomDto {
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  name: string;
}

export class PlayerCredentialsDto {
  @IsString()
  playerId: string;

  @IsString()
  @Length(48, 48)
  playerToken: string;
}

export class StartCompetitionDto extends PlayerCredentialsDto {
  @IsString()
  @Length(48, 48)
  hostToken: string;
}

export class SubmitCompetitionAnswerDto extends PlayerCredentialsDto {
  @IsString()
  @MaxLength(160)
  answer: string;

  @IsInt()
  @Min(0)
  questionIndex: number;
}

export class UseCompetitionHintDto extends PlayerCredentialsDto {
  @IsInt()
  @Min(0)
  questionIndex: number;
}
