import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CompetitionAnswer } from './entities/competition-answer.entity';
import { CompetitionPlayer } from './entities/competition-player.entity';
import { CompetitionRoom } from './entities/competition-room.entity';
import { CompetitionController } from './competition.controller';
import { CompetitionService } from './competition.service';
import { LlmModule } from '../llm/llm.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CompetitionRoom, CompetitionPlayer, CompetitionAnswer]),
    LlmModule,
  ],
  controllers: [CompetitionController],
  providers: [CompetitionService],
})
export class CompetitionModule {}
