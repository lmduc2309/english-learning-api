import { Module } from '@nestjs/common';
import { CacheModule } from '../../common/cache/cache.module';
import { AzureTtsClient } from './azure-tts.client';
import { TtsService } from './tts.service';
import { TtsController } from './tts.controller';

@Module({
  imports: [CacheModule],
  controllers: [TtsController],
  providers: [TtsService, AzureTtsClient],
  exports: [TtsService],
})
export class TtsModule {}
