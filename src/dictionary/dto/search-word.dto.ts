import { IsString, IsOptional, IsInt, IsIn, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class SearchWordDto {
  @ApiProperty({
    example: 'hello',
    description: 'Search query for word autocomplete',
  })
  @IsString()
  q: string;

  @ApiProperty({
    example: 15,
    required: false,
    description: 'Maximum number of suggestions',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 15;

  @ApiProperty({
    example: 'auto',
    required: false,
    enum: ['auto', 'en-vi', 'vi-en'],
    description: 'Search English headwords, Vietnamese meanings, or detect automatically',
  })
  @IsOptional()
  @IsIn(['auto', 'en-vi', 'vi-en'])
  direction?: 'auto' | 'en-vi' | 'vi-en' = 'auto';
}

export class WordSuggestion {
  @ApiProperty({ example: 'hello' })
  word: string;

  @ApiProperty({ example: '/həˈloʊ/', required: false })
  ipa?: string;

  @ApiProperty({ example: 'noun', required: false })
  pos?: string;

  @ApiProperty({ example: 'vi-en', required: false, enum: ['en-vi', 'vi-en'] })
  direction?: 'en-vi' | 'vi-en';

  @ApiProperty({ example: 'học; nghiên cứu một môn học', required: false })
  matched_text?: string;

  @ApiProperty({ example: 'To spend time learning about a subject.', required: false })
  definition_en?: string;

  @ApiProperty({ example: 'học; nghiên cứu một môn học', required: false })
  definition_vi?: string;

  @ApiProperty({ example: 'curated', required: false, enum: ['curated', 'raw_fallback'] })
  data_source?: 'curated' | 'raw_fallback';
}

export class SearchWordResponseDto {
  @ApiProperty({
    type: [WordSuggestion],
    example: [
      { word: 'hello', ipa: '/həˈloʊ/', pos: 'interjection' },
      { word: 'help', ipa: '/help/', pos: 'verb' }
    ]
  })
  suggestions: WordSuggestion[];

  @ApiProperty({ example: 2, required: false })
  count?: number;
}
