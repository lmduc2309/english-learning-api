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
    example: 10,
    required: false,
    description: 'Maximum number of suggestions',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 10;
}

export class SearchWordResponseDto {
  @ApiProperty({ example: ['hello', 'help', 'helicopter'] })
  suggestions: string[];
}
