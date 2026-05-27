import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { RedisCacheService } from '../../common/cache/redis-cache.service';
import { AzureTtsClient } from './azure-tts.client';
import { getVoice, isVoiceId, VoiceId } from './voice-catalog';

const MAX_TEXT_LENGTH = 600;
const TTL_SECONDS = 60 * 60 * 24 * 30;

@Injectable()
export class TtsService {
  constructor(
    private readonly cache: RedisCacheService,
    private readonly client: AzureTtsClient,
  ) {}

  async synthesize(text: string, voiceId: string): Promise<Buffer> {
    if (!text || !text.trim()) {
      throw new BadRequestException('text must not be empty');
    }
    if (text.length > MAX_TEXT_LENGTH) {
      throw new BadRequestException(`text must be <= ${MAX_TEXT_LENGTH} characters`);
    }
    if (!isVoiceId(voiceId)) {
      throw new BadRequestException(`unknown voiceId: ${voiceId}`);
    }

    const key = this.cacheKey(voiceId, text);
    const cached = await this.cache.get<string>(key);
    if (cached !== null) {
      return Buffer.from(cached, 'base64');
    }

    const voice = getVoice(voiceId);
    const mp3 = await this.client.synthesize(text, voice.azureName, voice.language);
    await this.cache.set(key, mp3.toString('base64'), { ttl: TTL_SECONDS });
    return mp3;
  }

  private cacheKey(voiceId: VoiceId, text: string): string {
    const digest = createHash('sha256').update(text, 'utf8').digest('hex');
    return `tts:${voiceId}:${digest}`;
  }
}
