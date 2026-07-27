import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LearnerEntry } from '../dictionary/entities/learner-entry.entity';
import { WordList } from '../word-list/entities/word-list.entity';
import { LookupHistory } from './entities/lookup-history.entity';
import { WordFolder } from './entities/word-folder.entity';
import { LearningController } from './learning.controller';
import { LearningService } from './learning.service';

@Module({
  imports: [TypeOrmModule.forFeature([LookupHistory, WordFolder, WordList, LearnerEntry])],
  controllers: [LearningController],
  providers: [LearningService],
})
export class LearningModule {}
