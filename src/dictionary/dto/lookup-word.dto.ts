import { ApiProperty } from '@nestjs/swagger';

export class PronunciationDto {
  @ApiProperty({ example: 'US' })
  accent: string;

  @ApiProperty({ example: '/həˈloʊ/' })
  ipa: string;

  @ApiProperty({ 
    example: 'https://api.dictionaryapi.dev/media/pronunciations/en/hello-us.mp3', 
    required: false,
    description: 'Audio URL for pronunciation' 
  })
  audio_url?: string;
}

export class ExampleDto {
  @ApiProperty({ example: 'Hello! How are you?' })
  en: string;

  @ApiProperty({ example: 'Xin chào! Bạn khỏe không?' })
  vi: string;
}

export class DefinitionDto {
  @ApiProperty({ example: 'interjection' })
  pos: string;

  @ApiProperty({ example: 'used as a greeting' })
  definition_en: string;

  @ApiProperty({ example: 'xin chào, chào' })
  definition_vi: string;

  @ApiProperty({ example: 'beginner' })
  level: string;

  @ApiProperty({ type: [ExampleDto] })
  examples: ExampleDto[];
}

export class LookupWordResponseDto {
  @ApiProperty({ example: 'hello' })
  word: string;

  @ApiProperty({ type: [PronunciationDto] })
  pronunciations: PronunciationDto[];

  @ApiProperty({ type: [DefinitionDto] })
  definitions: DefinitionDto[];

  @ApiProperty({
    example: { plural: 'hellos', present: 'helloing' },
    required: false,
  })
  word_forms?: Record<string, string>;

  @ApiProperty({ example: ['hi', 'hey', 'greetings'], required: false })
  synonyms?: string[];

  @ApiProperty({ example: 150, required: false })
  frequency_rank?: number;
}
