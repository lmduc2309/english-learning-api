import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LlmModule } from '../llm/llm.module';
import { VerbalMappingController } from './verbal-mapping.controller';
import { VerbalMappingService } from './verbal-mapping.service';
import { VerbalMappingSession } from './entities/verbal-mapping-session.entity';
import { VerbalMappingAttempt } from './entities/verbal-mapping-attempt.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([VerbalMappingSession, VerbalMappingAttempt]),
    LlmModule,
  ],
  controllers: [VerbalMappingController],
  providers: [VerbalMappingService],
})
export class VerbalMappingModule {}
