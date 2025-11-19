import { IsString, IsOptional, IsNumber, Min, Max, IsInt } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ChatDto {
  @ApiProperty({
    description: 'User message',
    example: 'What is the difference between affect and effect?',
  })
  @IsString()
  message: string;

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

  @ApiPropertyOptional({
    description: 'Maximum tokens to generate',
    example: 200,
    minimum: 10,
    maximum: 2000,
    default: 200,
  })
  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(2000)
  @Type(() => Number)
  maxTokens?: number = 200;
}

export class ChatResponseDto {
  @ApiProperty({
    description: 'AI response',
    example: 'Affect is typically a verb meaning to influence something...',
  })
  response: string;
}