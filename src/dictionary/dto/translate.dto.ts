import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class TranslateDto {
  @ApiProperty({
    example: 'Hello world',
    description: 'Text to translate',
  })
  @IsString()
  text: string;

  @ApiProperty({
    example: 'en',
    description: 'Source language code',
    default: 'en',
  })
  @IsString()
  source_lang: string = 'en';

  @ApiProperty({
    example: 'vi',
    description: 'Target language code',
    default: 'vi',
  })
  @IsString()
  target_lang: string = 'vi';
}

export class TranslateResponseDto {
  @ApiProperty({ example: 'Hello world' })
  original_text: string;

  @ApiProperty({ example: 'Xin chào thế giới' })
  translated_text: string;

  @ApiProperty({ example: 'en' })
  source_lang: string;

  @ApiProperty({ example: 'vi' })
  target_lang: string;
}
