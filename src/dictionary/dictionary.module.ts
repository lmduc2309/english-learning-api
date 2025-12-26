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

@Module({
  imports: [
    HttpModule,
    TypeOrmModule.forFeature([
      Word,
      Pronunciation,
      Definition,
      Example,
      WordForm,
      Synonym,
    ]),
  ],
  controllers: [DictionaryController],
  providers: [DictionaryService, AudioService],
  exports: [DictionaryService, AudioService],
})
export class DictionaryModule {}
