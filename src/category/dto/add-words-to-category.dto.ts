import { IsArray, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddWordsToCategoryDto {
  @ApiProperty({
    example: ['cat', 'dog', 'bird'],
    description: 'Array of word strings to add',
  })
  @IsArray()
  @IsString({ each: true })
  words: string[];
}
