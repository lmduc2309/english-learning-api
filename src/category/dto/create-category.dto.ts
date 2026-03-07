import { IsString, IsOptional, IsNumber } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCategoryDto {
  @ApiProperty({ example: 'animals', description: 'URL-friendly slug name' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'Animals', description: 'Display name' })
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

  @ApiProperty({ example: 'Nature', description: 'Topic group name' })
  @IsString()
  topic: string;

  @ApiPropertyOptional({ example: 1 })
  @IsNumber()
  @IsOptional()
  displayOrder?: number;
}
