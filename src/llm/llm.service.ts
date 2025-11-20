import { Injectable, HttpException, HttpStatus, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";
import {
  GenerateSentencesDto,
  GenerateSentencesResponseDto,
} from "./dto/generate-setences.dto";
import { ChatDto, ChatResponseDto } from "./dto/chat.dto";

interface VLLMCompletionRequest {
  model: string;
  prompt: string;
  temperature: number;
  max_tokens: number;
  stop?: string[];
}

interface VLLMCompletionResponse {
  choices: Array<{
    text: string;
    finish_reason: string;
  }>;
}

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly vllmUrl: string;
  private readonly vllmModel: string;

  constructor(
    private configService: ConfigService,
    private httpService: HttpService
  ) {
    this.vllmUrl = this.configService.get<string>("llm.url");
    this.vllmModel = this.configService.get<string>("llm.model");
    this.logger.log(
      `LLM Service initialized with URL: ${this.vllmUrl}, Model: ${this.vllmModel}`
    );
  }

  async generateSentences(
    dto: GenerateSentencesDto
  ): Promise<GenerateSentencesResponseDto> {
    try {
      const wordsStr = dto.words.join(", ");

      const difficultyInstructions = {
        beginner: "Use simple grammar and common words.",
        intermediate: "Use natural everyday English.",
        advanced: "Use sophisticated vocabulary and complex grammar.",
      };

      const prompt = `<|system|>
You are an English teacher helping students learn new vocabulary.
<|end|>
<|user|>
Create ${
        dto.numSentences
      } clear example sentences that use these words: ${wordsStr}

Requirements:
- Each sentence must use at least one of the words
- Make sentences natural and practical
- ${
        difficultyInstructions[dto.difficulty] ||
        difficultyInstructions.intermediate
      }
- Show the word in context
- Keep sentences concise and clear

Format: Return only the sentences, one per line, without numbering.
<|end|>
<|assistant|>
`;

      const vllmRequest: VLLMCompletionRequest = {
        model: this.vllmModel,
        prompt,
        temperature: dto.temperature,
        max_tokens: 500,
        stop: ["<|end|>", "<|user|>"],
      };

      this.logger.debug(
        `Sending request to vLLM: ${JSON.stringify(vllmRequest)}`
      );

      const response = await firstValueFrom(
        this.httpService.post<VLLMCompletionResponse>(
          this.vllmUrl,
          vllmRequest,
          {
            timeout: 30000,
          }
        )
      );

      const generatedText = response.data.choices[0].text.trim();
      this.logger.debug(`Generated text: ${generatedText}`);

      // Parse sentences
      const sentences = generatedText
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 10)
        .slice(0, dto.numSentences);

      if (sentences.length === 0) {
        throw new HttpException(
          "Failed to generate sentences",
          HttpStatus.INTERNAL_SERVER_ERROR
        );
      }

      return {
        sentences,
        wordsUsed: dto.words,
      };
    } catch (error) {
      this.logger.error(
        `Error generating sentences: ${error.message}`,
        error.stack
      );

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        `Failed to generate sentences: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async chat(dto: ChatDto): Promise<ChatResponseDto> {
    try {
      const prompt = `<|system|>
You are a helpful English teacher assistant. Answer questions about English grammar, vocabulary, and usage.
<|end|>
<|user|>
${dto.message}
<|end|>
<|assistant|>
`;

      const vllmRequest: VLLMCompletionRequest = {
        model: this.vllmModel,
        prompt,
        temperature: dto.temperature,
        max_tokens: dto.maxTokens,
        stop: ["<|end|>", "<|user|>"],
      };

      this.logger.debug(`Sending chat request to vLLM`);

      const response = await firstValueFrom(
        this.httpService.post<VLLMCompletionResponse>(
          this.vllmUrl,
          vllmRequest,
          {
            timeout: 30000,
          }
        )
      );

      const responseText = response.data.choices[0].text.trim();

      return {
        response: responseText,
      };
    } catch (error) {
      this.logger.error(`Error in chat: ${error.message}`, error.stack);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        `Failed to process chat: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async healthCheck(): Promise<{ status: string; model: string; url: string }> {
    return {
      status: "healthy",
      model: this.vllmModel,
      url: this.vllmUrl,
    };
  }
}
