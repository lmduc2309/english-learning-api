import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WordListService } from './word-list.service';
import { WordListController } from './word-list.controller';
import { WordList } from './entities/word-list.entity';

@Module({
  imports: [TypeOrmModule.forFeature([WordList])],
  controllers: [WordListController],
  providers: [WordListService],
  exports: [WordListService],
})
export class WordListModule {}
