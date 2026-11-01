import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LlmModule } from '../llm/llm.module';
import { PolishCorrectionEntity } from './entities/polish-correction.entity';
import { PolishPhrase } from './entities/polish-phrase.entity';
import { PolishSession } from './entities/polish-session.entity';
import { PolishOwnerGuard } from './polish-owner.guard';
import { PolishController } from './polish.controller';
import { PolishService } from './polish.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([PolishSession, PolishCorrectionEntity, PolishPhrase]),
    LlmModule,
  ],
  controllers: [PolishController],
  providers: [PolishService, PolishOwnerGuard],
})
export class PolishModule {}
