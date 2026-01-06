import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Request,
  Query,
} from '@nestjs/common';
import { WordListService } from './word-list.service';
import { CreateWordDto } from './dto/create-word.dto';
import { UpdateWordDto } from './dto/update-word.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('serious/word-list')
@UseGuards(JwtAuthGuard)
export class WordListController {
  constructor(private readonly wordListService: WordListService) {}

  @Post()
  create(@Request() req, @Body() createWordDto: CreateWordDto) {
    return this.wordListService.create(req.user.userId, createWordDto);
  }

  @Get()
  findAll(@Request() req, @Query('search') search?: string) {
    return this.wordListService.findAll(req.user.userId, search);
  }

  @Get(':id')
  findOne(@Request() req, @Param('id') id: string) {
    return this.wordListService.findOne(req.user.userId, id);
  }

  @Patch(':id')
  update(
    @Request() req,
    @Param('id') id: string,
    @Body() updateWordDto: UpdateWordDto,
  ) {
    return this.wordListService.update(req.user.userId, id, updateWordDto);
  }

  @Delete(':id')
  remove(@Request() req, @Param('id') id: string) {
    return this.wordListService.remove(req.user.userId, id);
  }

  @Delete('by-word/:word')
  removeByWord(@Request() req, @Param('word') word: string) {
    return this.wordListService.removeByWord(req.user.userId, word);
  }

  @Delete()
  clear(@Request() req) {
    return this.wordListService.clear(req.user.userId);
  }

  @Post('import')
  import(@Request() req, @Body() body: { words: string[] }) {
    return this.wordListService.import(req.user.userId, body.words);
  }
}
