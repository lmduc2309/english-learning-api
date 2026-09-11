import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

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
  @ArrayUnique((word: string) => word.trim().toLocaleLowerCase())
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(80, { each: true })
  words: string[];
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
