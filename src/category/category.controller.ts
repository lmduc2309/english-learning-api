import {
  Controller,
  Get,
  Post,
  Delete,
  Query,
  Param,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { CategoryService } from './category.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { AddWordsToCategoryDto } from './dto/add-words-to-category.dto';
import { SeedCategoriesDto } from './dto/seed-categories.dto';

@ApiTags('Categories')
@Controller('serious/categories')
export class CategoryController {
  constructor(private readonly categoryService: CategoryService) {}

  @Get('topics')
  @ApiOperation({ summary: 'Get all distinct topics' })
  @ApiResponse({ status: 200, description: 'List of topics with category counts' })
  async getTopics() {
    return this.categoryService.getTopics();
  }

  @Get('search/categories')
  @ApiOperation({ summary: 'Search categories with autocomplete' })
  @ApiQuery({ name: 'q', description: 'Search query', required: true })
  @ApiQuery({ name: 'limit', description: 'Maximum results (default: 15)', required: false })
  @ApiResponse({ status: 200, description: 'Category suggestions returned' })
  async searchCategories(
    @Query('q') query: string,
    @Query('limit') limit?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : 15;
    return this.categoryService.searchCategories(query, limitNum);
  }

  @Get('search/topics')
  @ApiOperation({ summary: 'Search topics with autocomplete' })
  @ApiQuery({ name: 'q', description: 'Search query', required: true })
  @ApiQuery({ name: 'limit', description: 'Maximum results (default: 15)', required: false })
  @ApiResponse({ status: 200, description: 'Topic suggestions returned' })
  async searchTopics(
    @Query('q') query: string,
    @Query('limit') limit?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : 15;
    return this.categoryService.searchTopics(query, limitNum);
  }

  @Get()
  @ApiOperation({ summary: 'Get all categories, optionally filtered by topic' })
  @ApiQuery({ name: 'topic', required: false, description: 'Filter by topic name' })
  @ApiQuery({ name: 'parentOnly', required: false, description: 'Only return root categories (no parent)', type: Boolean })
  @ApiResponse({ status: 200, description: 'List of categories' })
  async getCategories(
    @Query('topic') topic?: string,
    @Query('parentOnly') parentOnly?: string,
  ) {
    return this.categoryService.getCategories(topic, parentOnly === 'true');
  }

  @Get(':idOrName')
  @ApiOperation({ summary: 'Get a single category by ID or name' })
  @ApiParam({ name: 'idOrName', description: 'Category ID or slug name' })
  @ApiResponse({ status: 200, description: 'Category details' })
  @ApiResponse({ status: 404, description: 'Category not found' })
  async getCategory(@Param('idOrName') idOrName: string) {
    return this.categoryService.getCategory(idOrName);
  }

  @Get(':idOrName/subcategories')
  @ApiOperation({ summary: 'Get subcategories of a parent category' })
  @ApiParam({ name: 'idOrName', description: 'Parent category ID or slug name' })
  @ApiResponse({ status: 200, description: 'List of subcategories' })
  async getSubCategories(@Param('idOrName') idOrName: string) {
    return this.categoryService.getSubCategories(idOrName);
  }

  @Get(':idOrName/words')
  @ApiOperation({ summary: 'Get words in a category with pagination' })
  @ApiParam({ name: 'idOrName', description: 'Category ID or slug name' })
  @ApiQuery({ name: 'page', required: false, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, description: 'Words per page (default: 100)' })
  @ApiQuery({ name: 'search', required: false, description: 'Search/filter words by name (case-insensitive)' })
  @ApiResponse({ status: 200, description: 'Category words with definitions (paginated)' })
  @ApiResponse({ status: 404, description: 'Category not found' })
  async getCategoryWords(
    @Param('idOrName') idOrName: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 100;
    return this.categoryService.getCategoryWords(idOrName, pageNum, limitNum, search);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new category' })
  @ApiResponse({ status: 201, description: 'Category created' })
  async createCategory(@Body() dto: CreateCategoryDto) {
    return this.categoryService.createCategory(dto);
  }

  @Post(':idOrName/words')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add words to a category' })
  @ApiParam({ name: 'idOrName', description: 'Category ID or slug name' })
  @ApiResponse({ status: 200, description: 'Words added result' })
  async addWordsToCategory(
    @Param('idOrName') idOrName: string,
    @Body() dto: AddWordsToCategoryDto,
  ) {
    return this.categoryService.addWordsToCategory(idOrName, dto.words);
  }

  @Delete(':idOrName/words/:word')
  @ApiOperation({ summary: 'Remove a word from a category' })
  @ApiParam({ name: 'idOrName', description: 'Category ID or slug name' })
  @ApiParam({ name: 'word', description: 'Word to remove' })
  @ApiResponse({ status: 200, description: 'Word removed' })
  async removeWordFromCategory(
    @Param('idOrName') idOrName: string,
    @Param('word') word: string,
  ) {
    await this.categoryService.removeWordFromCategory(idOrName, word);
    return { message: 'Word removed from category' };
  }

  @Post('seed')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Seed categories with words (admin)' })
  @ApiResponse({ status: 200, description: 'Seeding result' })
  async seedCategories(@Body() dto: SeedCategoriesDto) {
    return this.categoryService.seedCategories(dto.categories);
  }
}
