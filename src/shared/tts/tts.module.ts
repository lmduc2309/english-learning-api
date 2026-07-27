import { Module } from '@nestjs/common';
import { CacheModule } from '../../common/cache/cache.module';
import { LocalTtsClient } from './local-tts.client';
import { TtsService } from './tts.service';
import { TtsController } from './tts.controller';

@Module({
  imports: [CacheModule],
  controllers: [TtsController],
  providers: [TtsService, LocalTtsClient],
  exports: [TtsService],
})
export class TtsModule {}
