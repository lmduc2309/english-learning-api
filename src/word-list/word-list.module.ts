import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WordListService } from './word-list.service';
import { WordListController } from './word-list.controller';
import { WordList } from './entities/word-list.entity';
import { CacheModule } from '../common/cache/cache.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([WordList]),
    CacheModule,
  ],
  controllers: [WordListController],
  providers: [WordListService],
  exports: [WordListService],
})
export class WordListModule {}
