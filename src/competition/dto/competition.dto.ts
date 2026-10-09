import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  CompetitionGameMode,
  CompetitionQuestionMode,
} from '../entities/competition-room.entity';

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

  @IsOptional()
  @IsIn(['recall', 'fill-blank', 'mixed'])
  questionMode?: CompetitionQuestionMode;

  @IsOptional()
  @IsIn(['typed', 'voice-buzz', 'paragraph-race'])
  gameMode?: CompetitionGameMode;

  @ValidateIf((dto: CreateCompetitionRoomDto) => dto.paragraphs === undefined)
  @IsArray()
  @ArrayMinSize(3)
  @ArrayMaxSize(90)
  @ArrayUnique((word: string) => word.trim().toLocaleLowerCase())
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(80, { each: true })
  words?: string[];

  /** Host-written Paragraph Race rounds with answers in [brackets]; skips AI generation. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(3)
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(700, { each: true })
  paragraphs?: string[];
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
  @MaxLength(1000)
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

export class ClaimCompetitionTurnDto extends PlayerCredentialsDto {
  @IsInt()
  @Min(0)
  questionIndex: number;
}
