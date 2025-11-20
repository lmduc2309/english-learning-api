import { IsArray, IsString, IsOptional, IsInt, Min, Max, IsNumber, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GenerateSentencesDto {
  @ApiProperty({
    description: 'List of words to use in sentences',
    example: ['apple', 'happy', 'quickly'],
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  words: string[];

  @ApiPropertyOptional({
    description: 'Number of sentences to generate',
    example: 3,
    minimum: 1,
    maximum: 10,
    default: 3,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  @Type(() => Number)
  numSentences?: number = 3;

  @ApiPropertyOptional({
    description: 'Difficulty level',
    enum: ['beginner', 'intermediate', 'advanced'],
    example: 'intermediate',
    default: 'intermediate',
  })
  @IsOptional()
  @IsIn(['beginner', 'intermediate', 'advanced'])
  difficulty?: string = 'intermediate';

  @ApiPropertyOptional({
    description: 'Temperature for generation (0-1)',
    example: 0.7,
    minimum: 0,
    maximum: 1,
    default: 0.7,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  @Type(() => Number)
  temperature?: number = 0.7;
}

export class GenerateSentencesResponseDto {
  @ApiProperty({
    description: 'Generated sentences',
    example: [
      'The apple was sweet and juicy.',
      'She felt happy after receiving the good news.',
      'He ran quickly to catch the bus.',
    ],
    type: [String],
  })
  sentences: string[];

  @ApiProperty({
    description: 'Words that were used',
    example: ['apple', 'happy', 'quickly'],
    type: [String],
  })
  wordsUsed: string[];
}