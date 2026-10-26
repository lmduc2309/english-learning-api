import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsString, Length, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

class WordsfallPairDto {
  @IsString() @MinLength(1) @MaxLength(80)
  en: string;

  @IsString() @MinLength(1) @MaxLength(80)
  vi: string;
}

export class CreateWordsfallRoomDto {
  @IsString() @MinLength(2) @MaxLength(80)
  name: string;

  @IsString() @MinLength(1) @MaxLength(32)
  hostName: string;

  @IsIn(['en-vi', 'vi-en'])
  direction: 'en-vi' | 'vi-en';

  @IsArray() @ArrayMinSize(3) @ArrayMaxSize(60)
  @ValidateNested({ each: true }) @Type(() => WordsfallPairDto)
  pairs: WordsfallPairDto[];
}

export class JoinWordsfallRoomDto {
  @IsString() @MinLength(1) @MaxLength(32)
  name: string;
}

export class WordsfallCredentialsDto {
  @IsString()
  playerId: string;

  @IsString() @Length(48, 48)
  playerToken: string;
}

export class StartWordsfallRoomDto extends WordsfallCredentialsDto {
  @IsString() @Length(48, 48)
  hostToken: string;
}

export class SubmitWordsfallAnswerDto extends WordsfallCredentialsDto {
  @IsInt() @Min(0)
  wordIndex: number;

  @IsString() @MinLength(1) @MaxLength(80)
  answer: string;
}
