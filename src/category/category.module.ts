import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CategoryController } from './category.controller';
import { CategoryService } from './category.service';
import { Category } from './entities/category.entity';
import { CategoryWord } from './entities/category-word.entity';
import { Word } from '../dictionary/entities/word.entity';
import { SearchModule } from '../common/search/search.module';
import { CacheModule } from '../common/cache/cache.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Category, CategoryWord, Word]),
    SearchModule,
    CacheModule,
  ],
  controllers: [CategoryController],
  providers: [CategoryService],
  exports: [CategoryService],
})
export class CategoryModule {}
