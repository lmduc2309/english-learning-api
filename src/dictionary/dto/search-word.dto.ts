import { IsString, IsOptional, IsInt, Min, Max } from 'class-validator';
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
}

export class WordSuggestion {
  @ApiProperty({ example: 'hello' })
  word: string;

  @ApiProperty({ example: '/həˈloʊ/', required: false })
  ipa?: string;

  @ApiProperty({ example: 'noun', required: false })
  pos?: string;
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
