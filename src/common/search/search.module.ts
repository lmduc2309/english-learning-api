import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SearchIndexService } from './search-index.service';
import { Word } from '../../dictionary/entities/word.entity';
import { Category } from '../../category/entities/category.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Word, Category])],
  providers: [SearchIndexService],
  exports: [SearchIndexService],
})
export class SearchModule {}
