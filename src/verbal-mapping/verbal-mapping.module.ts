import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LlmModule } from '../llm/llm.module';
import { WordListModule } from '../word-list/word-list.module';
import { VerbalMappingController } from './verbal-mapping.controller';
import { VerbalMappingService } from './verbal-mapping.service';
import { VerbalMappingSession } from './entities/verbal-mapping-session.entity';
import { VerbalMappingAttempt } from './entities/verbal-mapping-attempt.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([VerbalMappingSession, VerbalMappingAttempt]),
    LlmModule,
    WordListModule,
  ],
  controllers: [VerbalMappingController],
  providers: [VerbalMappingService],
})
export class VerbalMappingModule {}
