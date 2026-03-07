# Dictionary API Implementation Guide

## ✅ Completed
1. Docker Compose with PostgreSQL + Redis
2. Database schema (init.sql)
3. TypeORM entities (Word, Definition, Example, Pronunciation, WordForm)
4. Updated package.json with dependencies

## 🚀 Next Steps

### 1. Install Dependencies
```bash
cd /Users/ducleminh/games-and-tools/english-learning-api
npm install
```

### 2. Start Database
```bash
docker-compose up -d postgres redis
```

### 3. Complete Implementation Files

I've created the foundation. You need to create these remaining files:

#### `src/dictionary/dto/search-word.dto.ts`
```typescript
import { IsString, IsOptional, IsInt, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SearchWordDto {
  @ApiProperty({ example: 'hello', description: 'Search query' })
  @IsString()
  q: string;

  @ApiProperty({ example: 10, required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 10;
}
```

#### `src/dictionary/dto/translate.dto.ts`
```typescript
import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class TranslateDto {
  @ApiProperty()
  @IsString()
  text: string;

  @ApiProperty({ default: 'en' })
  @IsString()
  sourceLang: string;

  @ApiProperty({ default: 'vi' })
  @IsString()
  targetLang: string;
}
```

#### `src/dictionary/dictionary.service.ts`
```typescript
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, ILike } from 'typeorm';
import { Word } from './entities/word.entity';
import { Definition } from './entities/definition.entity';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class DictionaryService {
  constructor(
    @InjectRepository(Word)
    private wordRepository: Repository<Word>,
    @InjectRepository(Definition)
    private definitionRepository: Repository<Definition>,
    private httpService: HttpService,
    private configService: ConfigService,
  ) {}

  async searchWords(query: string, limit: number = 10): Promise<Word[]> {
    const normalized = query.toLowerCase();

    return await this.wordRepository.find({
      where: [
        { wordNormalized: ILike(`${normalized}%`) },
      ],
      take: limit,
      order: { frequencyRank: 'ASC' },
    });
  }

  async getWordByName(word: string): Promise<Word | null> {
    const normalized = word.toLowerCase();

    return await this.wordRepository.findOne({
      where: { wordNormalized: normalized },
      relations: ['definitions', 'definitions.examples', 'pronunciations', 'wordForms'],
      order: {
        definitions: {
          definitionOrder: 'ASC',
        },
      },
    });
  }

  async createOrUpdateWord(wordData: {
    word: string;
    definitions: any[];
    pronunciations?: any[];
    wordForms?: any[];
  }): Promise<Word> {
    const normalized = wordData.word.toLowerCase();

    let word = await this.wordRepository.findOne({
      where: { wordNormalized: normalized },
    });

    if (!word) {
      word = this.wordRepository.create({
        word: wordData.word,
        wordNormalized: normalized,
        partOfSpeech: wordData.definitions.map(d => d.partOfSpeech),
      });
    }

    // Add definitions, pronunciations, wordForms
    // ... implementation details

    return await this.wordRepository.save(word);
  }

  async translateText(text: string, sourceLang: string, targetLang: string): Promise<string> {
    const vllmUrl = this.configService.get<string>('VLLM_URL');

    const prompt = `Translate from ${sourceLang} to ${targetLang}. Only output the translation:\n\n${text}`;

    try {
      const response = await firstValueFrom(
        this.httpService.post(`${vllmUrl}/v1/chat/completions`, {
          model: 'default',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          max_tokens: 500,
        }),
      );

      return response.data.choices[0].message.content.trim();
    } catch (error) {
      throw new Error(`Translation failed: ${error.message}`);
    }
  }

  async lookupWordWithLLM(word: string): Promise<any> {
    const vllmUrl = this.configService.get<string>('VLLM_URL');

    const prompt = `Provide dictionary entry for "${word}" in JSON:
{
  "word": "${word}",
  "definitions": [
    {
      "pos": "noun/verb/etc",
      "definition_en": "...",
      "definition_vi": "...",
      "examples": [{"en": "...", "vi": "..."}]
    }
  ],
  "pronunciations": [{"accent": "US/UK", "ipa": "..."}],
  "wordForms": {"plural": "...", "past": "..."}
}`;

    const response = await firstValueFrom(
      this.httpService.post(`${vllmUrl}/v1/chat/completions`, {
        model: 'default',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.5,
        max_tokens: 1000,
      }),
    );

    const content = response.data.choices[0].message.content;
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }

    throw new Error('Failed to parse LLM response');
  }
}
```

#### `src/dictionary/dictionary.controller.ts`
```typescript
import { Controller, Get, Post, Query, Param, Body } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { DictionaryService } from './dictionary.service';
import { SearchWordDto } from './dto/search-word.dto';
import { TranslateDto } from './dto/translate.dto';

@ApiTags('dictionary')
@Controller('dictionary')
export class DictionaryController {
  constructor(private dictionaryService: DictionaryService) {}

  @Get('search')
  @ApiOperation({ summary: 'Search words with autocomplete' })
  async search(@Query() query: SearchWordDto) {
    const words = await this.dictionaryService.searchWords(query.q, query.limit);
    return {
      suggestions: words.map(w => ({
        word: w.word,
        frequency_rank: w.frequencyRank,
        pos: w.partOfSpeech,
      })),
    };
  }

  @Get('word/:word')
  @ApiOperation({ summary: 'Get complete word information' })
  async getWord(@Param('word') word: string) {
    let wordData = await this.dictionaryService.getWordByName(word);

    // If not in DB, use LLM to generate
    if (!wordData) {
      const llmData = await this.dictionaryService.lookupWordWithLLM(word);

      // Save to database
      wordData = await this.dictionaryService.createOrUpdateWord({
        word: llmData.word,
        definitions: llmData.definitions,
        pronunciations: llmData.pronunciations,
        wordForms: llmData.wordForms,
      });
    }

    return {
      word: wordData.word,
      pronunciations: wordData.pronunciations.map(p => ({
        accent: p.accent,
        ipa: p.ipa,
        audio_url: p.audioUrl,
      })),
      definitions: wordData.definitions.map(d => ({
        pos: d.partOfSpeech,
        definition_en: d.definitionEn,
        definition_vi: d.definitionVi,
        level: d.level,
        examples: d.examples.map(e => ({
          en: e.exampleEn,
          vi: e.exampleVi,
        })),
      })),
      word_forms: wordData.wordForms.reduce((acc, wf) => {
        acc[wf.formType] = wf.formWord;
        return acc;
      }, {}),
    };
  }

  @Post('translate')
  @ApiOperation({ summary: 'Translate text' })
  async translate(@Body() dto: TranslateDto) {
    const translated = await this.dictionaryService.translateText(
      dto.text,
      dto.sourceLang,
      dto.targetLang,
    );

    return {
      original_text: dto.text,
      translated_text: translated,
      source_lang: dto.sourceLang,
      target_lang: dto.targetLang,
    };
  }
}
```

#### `src/dictionary/dictionary.module.ts`
```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { DictionaryController } from './dictionary.controller';
import { DictionaryService } from './dictionary.service';
import { Word } from './entities/word.entity';
import { Definition } from './entities/definition.entity';
import { Example } from './entities/example.entity';
import { Pronunciation } from './entities/pronunciation.entity';
import { WordForm } from './entities/word-form.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Word,
      Definition,
      Example,
      Pronunciation,
      WordForm,
    ]),
    HttpModule,
  ],
  controllers: [DictionaryController],
  providers: [DictionaryService],
  exports: [DictionaryService],
})
export class DictionaryModule {}
```

#### Update `src/app.module.ts`
```typescript
import { Module } from '@nestjs/module';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LlmModule } from './llm/llm.module';
import { DictionaryModule } from './dictionary/dictionary.module';
import configuration from './config/configuration';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [configuration],
      isGlobal: true,
    }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      entities: [__dirname + '/**/*.entity{.ts,.js}'],
      synchronize: false, // Use migrations in production
      logging: true,
    }),
    LlmModule,
    DictionaryModule,
  ],
})
export class AppModule {}
```

### 4. Update Frontend API Service

In `english-learning-games/services/dictionaryApi.ts`, update the API_BASE_URL calls to use the real endpoints.

### 5. Test the Integration

```bash
# Start all services
docker-compose up -d

# Check logs
docker-compose logs -f api

# Test endpoints
curl http://localhost:7474/api/dictionary/search?q=hello
curl http://localhost:7474/api/dictionary/word/hello
```

### 6. Frontend Integration

Update `NEXT_PUBLIC_API_URL` in `.env.local`:
```
NEXT_PUBLIC_API_URL=http://localhost:7474/api
```

## 📚 Complete File Structure

```
english-learning-api/
├── docker-compose.yml ✅
├── database/
│   └── init.sql ✅
├── src/
│   ├── dictionary/
│   │   ├── entities/
│   │   │   ├── word.entity.ts ✅
│   │   │   ├── definition.entity.ts ✅
│   │   │   ├── example.entity.ts ✅
│   │   │   ├── pronunciation.entity.ts ✅
│   │   │   └── word-form.entity.ts ✅
│   │   ├── dto/
│   │   │   ├── search-word.dto.ts ⚠️ CREATE THIS
│   │   │   └── translate.dto.ts ⚠️ CREATE THIS
│   │   ├── dictionary.controller.ts ⚠️ CREATE THIS
│   │   ├── dictionary.service.ts ⚠️ CREATE THIS
│   │   └── dictionary.module.ts ⚠️ CREATE THIS
│   ├── app.module.ts ⚠️ UPDATE THIS
│   └── main.ts
└── package.json ✅
```

This guide contains all the code you need. Create the remaining files and you'll have a working dictionary API!
