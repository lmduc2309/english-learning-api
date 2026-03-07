import { IsArray, ValidateNested, IsString, IsOptional, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class SeedCategoryItemDto {
  @ApiProperty({ example: 'animals' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'Animals' })
  @IsString()
  displayName: string;

  @ApiPropertyOptional({ example: 'Common animal vocabulary' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: '🐾' })
  @IsString()
  @IsOptional()
  icon?: string;

  @ApiProperty({ example: 'Nature' })
  @IsString()
  topic: string;

  @ApiPropertyOptional({ example: 1 })
  @IsNumber()
  @IsOptional()
  displayOrder?: number;

  @ApiPropertyOptional({ example: ['cat', 'dog', 'bird'] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  words?: string[];
}

export class SeedCategoriesDto {
  @ApiProperty({ type: [SeedCategoryItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SeedCategoryItemDto)
  categories: SeedCategoryItemDto[];
}
