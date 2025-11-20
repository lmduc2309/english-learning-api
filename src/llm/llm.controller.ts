import { Controller, Post, Get, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { LlmService } from './llm.service';
import { GenerateSentencesDto, GenerateSentencesResponseDto } from './dto/generate-setences.dto';
import { ChatDto, ChatResponseDto } from './dto/chat.dto';

@ApiTags('LLM')
@Controller('api/llm')
export class LlmController {
  constructor(private readonly llmService: LlmService) {}

  @Get('health')
  @ApiOperation({ summary: 'Health check' })
  @ApiResponse({ status: 200, description: 'Service is healthy' })
  healthCheck() {
    return this.llmService.healthCheck();
  }

  @Post('generate-sentences')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate example sentences using specific words' })
  @ApiResponse({
    status: 200,
    description: 'Sentences generated successfully',
    type: GenerateSentencesResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async generateSentences(
    @Body() generateSentencesDto: GenerateSentencesDto,
  ): Promise<GenerateSentencesResponseDto> {
    return this.llmService.generateSentences(generateSentencesDto);
  }

  @Post('chat')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Chat with English teacher assistant' })
  @ApiResponse({
    status: 200,
    description: 'Chat response generated successfully',
    type: ChatResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async chat(@Body() chatDto: ChatDto): Promise<ChatResponseDto> {
    return this.llmService.chat(chatDto);
  }
}