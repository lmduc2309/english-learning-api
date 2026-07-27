import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DictionaryController } from './dictionary.controller';
import { DictionaryService } from './dictionary.service';
import { AudioService } from './audio.service';
import { Word } from './entities/word.entity';
import { Pronunciation } from './entities/pronunciation.entity';
import { Definition } from './entities/definition.entity';
import { Example } from './entities/example.entity';
import { WordForm } from './entities/word-form.entity';
import { Synonym } from './entities/synonym.entity';
import { SearchModule } from '../common/search/search.module';
import { CacheModule } from '../common/cache/cache.module';
import { LlmModule } from '../llm/llm.module';
import { LearnerSense } from './entities/learner-sense.entity';
import { LearnerEntry } from './entities/learner-entry.entity';
import { LearnerExample } from './entities/learner-example.entity';
import { LearnerPronunciation } from './entities/learner-pronunciation.entity';
import { LearnerSenseTranslation } from './entities/learner-sense-translation.entity';

@Module({
  imports: [
    HttpModule,
    SearchModule,
    CacheModule,
    LlmModule,
    TypeOrmModule.forFeature([
      Word,
      Pronunciation,
      Definition,
      Example,
      WordForm,
      Synonym,
      LearnerSense,
      LearnerEntry,
      LearnerExample,
      LearnerPronunciation,
      LearnerSenseTranslation,
    ]),
  ],
  controllers: [DictionaryController],
  providers: [DictionaryService, AudioService],
  exports: [DictionaryService, AudioService],
})
export class DictionaryModule {}
