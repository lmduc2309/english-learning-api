import {
  Controller,
  Post,
  Get,
  Query,
  Param,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { DictionaryService } from './dictionary.service';
import { SearchWordDto, SearchWordResponseDto } from './dto/search-word.dto';
import { LookupWordResponseDto } from './dto/lookup-word.dto';
import { TranslateDto, TranslateResponseDto } from './dto/translate.dto';

@ApiTags('Dictionary')
@Controller('api/dictionary')
export class DictionaryController {
  constructor(private readonly dictionaryService: DictionaryService) {}

  @Get('health')
  @ApiOperation({ summary: 'Health check for dictionary service' })
  @ApiResponse({ status: 200, description: 'Service is healthy' })
  healthCheck() {
    return this.dictionaryService.healthCheck();
  }

  @Get('search')
  @ApiOperation({ summary: 'Search words with autocomplete' })
  @ApiResponse({
    status: 200,
    description: 'Word suggestions returned successfully',
    type: SearchWordResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async searchWords(
    @Query() query: SearchWordDto,
  ): Promise<SearchWordResponseDto> {
    return this.dictionaryService.searchWords(query);
  }

  @Get('word/:word')
  @ApiOperation({ summary: 'Get complete word information with definitions' })
  @ApiParam({ name: 'word', example: 'hello', description: 'Word to lookup' })
  @ApiResponse({
    status: 200,
    description: 'Word information retrieved successfully',
    type: LookupWordResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Word not found' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async lookupWord(@Param('word') word: string): Promise<LookupWordResponseDto> {
    return this.dictionaryService.lookupWord(word);
  }

  @Post('translate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Translate text between languages' })
  @ApiResponse({
    status: 200,
    description: 'Text translated successfully',
    type: TranslateResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async translate(@Body() dto: TranslateDto): Promise<TranslateResponseDto> {
    return this.dictionaryService.translate(dto);
  }
}
