import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

interface FreeDictionaryApiResponse {
  word: string;
  phonetics: Array<{
    text?: string;
    audio?: string;
  }>;
}

@Injectable()
export class AudioService {
  private readonly logger = new Logger(AudioService.name);

  constructor(private httpService: HttpService) {}

  /**
   * Fetch audio URL from Free Dictionary API
   * Returns US and UK audio URLs if available
   */
  async fetchAudioFromFreeDictionary(
    word: string,
  ): Promise<{ us?: string; uk?: string }> {
    try {
      const response = await firstValueFrom(
        this.httpService.get<FreeDictionaryApiResponse[]>(
          `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
          { timeout: 5000 },
        ),
      );

      const data = response.data;
      if (!data || data.length === 0) {
        this.logger.warn(`No audio data found for word: ${word}`);
        return {};
      }

      const result: { us?: string; uk?: string } = {};

      // Extract audio URLs from phonetics
      for (const entry of data) {
        if (entry.phonetics && entry.phonetics.length > 0) {
          for (const phonetic of entry.phonetics) {
            if (phonetic.audio) {
              // Free Dictionary API audio URLs contain hints about accent
              const audioUrl = phonetic.audio;
              
              if (audioUrl.includes('-us.mp3') || audioUrl.includes('/us/')) {
                result.us = audioUrl;
              } else if (audioUrl.includes('-uk.mp3') || audioUrl.includes('/uk/')) {
                result.uk = audioUrl;
              } else if (!result.us && !result.uk) {
                // If no specific accent identified, use as US by default
                result.us = audioUrl;
              }
            }
          }
        }
      }

      this.logger.log(
        `Fetched audio for "${word}": US=${!!result.us}, UK=${!!result.uk}`,
      );
      return result;
    } catch (error) {
      this.logger.error(
        `Failed to fetch audio for "${word}": ${error.message}`,
      );
      return {};
    }
  }

  /**
   * Get audio URL for specific word and accent
   * Returns the audio URL or null if not available
   */
  async getAudioUrl(word: string, accent: 'US' | 'UK'): Promise<string | null> {
    const audioUrls = await this.fetchAudioFromFreeDictionary(word);
    
    if (accent === 'US') {
      return audioUrls.us || audioUrls.uk || null;
    } else {
      return audioUrls.uk || audioUrls.us || null;
    }
  }

  /**
   * Generate TTS audio URL using external service
   * This is a placeholder - you can integrate with Google TTS, AWS Polly, etc.
   */
  async generateTTSAudio(
    text: string,
    accent: 'US' | 'UK',
  ): Promise<string | null> {
    // TODO: Integrate with TTS service
    // For now, return null to fall back to client-side Web Speech API
    this.logger.warn(
      `TTS generation not implemented. Text: "${text}", Accent: ${accent}`,
    );
    return null;
  }
}
