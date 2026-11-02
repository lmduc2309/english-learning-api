import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PolishRequestDto } from './dto/polish-request.dto';
import { SavePhraseDto } from './dto/save-phrase.dto';
import { SaveSessionDto } from './dto/save-session.dto';
import { UpdatePhraseDto } from './dto/update-phrase.dto';
import { PolishOwnerGuard } from './polish-owner.guard';
import { PolishService } from './polish.service';

@ApiTags('Polish')
@ApiBearerAuth()
@Controller('serious/polish')
@UseGuards(JwtAuthGuard, PolishOwnerGuard)
export class PolishController {
  constructor(private readonly service: PolishService) {}

  @Get('access')
  @ApiOperation({ summary: 'Check owner access to Polish' })
  @ApiResponse({ status: 200, description: 'Caller is an allowed owner' })
  @ApiResponse({ status: 403, description: 'Not an allowed owner' })
  access() {
    return { allowed: true };
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Polish a draft in the requested tone' })
  @ApiResponse({ status: 200, description: 'Polished text with corrections' })
  @ApiResponse({ status: 400, description: 'Invalid or too long text' })
  @ApiResponse({ status: 502, description: 'Model returned unusable output' })
  polish(@Body() dto: PolishRequestDto) {
    return this.service.polish(dto.text, dto.tone);
  }

  @Post('sessions')
  @ApiOperation({ summary: 'Save a polish session' })
  saveSession(@Request() req, @Body() dto: SaveSessionDto) {
    return this.service.saveSession(req.user.userId, dto);
  }

  @Get('sessions')
  @ApiOperation({ summary: 'List saved polish sessions' })
  listSessions(@Request() req) {
    return this.service.listSessions(req.user.userId);
  }

  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a saved polish session' })
  deleteSession(@Request() req, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.deleteSession(req.user.userId, id);
  }

  @Post('phrases')
  @ApiOperation({ summary: 'Save a phrase' })
  savePhrase(@Request() req, @Body() dto: SavePhraseDto) {
    return this.service.savePhrase(req.user.userId, dto);
  }

  @Get('phrases')
  @ApiOperation({ summary: 'List saved phrases' })
  listPhrases(@Request() req) {
    return this.service.listPhrases(req.user.userId);
  }

  @Patch('phrases/:id')
  @ApiOperation({ summary: 'Change a phrase situation' })
  updatePhrase(@Request() req, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePhraseDto) {
    return this.service.updatePhrase(req.user.userId, id, dto);
  }

  @Delete('phrases/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a saved phrase' })
  deletePhrase(@Request() req, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.deletePhrase(req.user.userId, id);
  }

  @Get('notebook')
  @ApiOperation({ summary: 'Mistake patterns, tone and trend summary' })
  notebook(@Request() req) {
    return this.service.notebook(req.user.userId);
  }
}
