import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WordList } from './entities/word-list.entity';
import { CreateWordDto } from './dto/create-word.dto';
import { UpdateWordDto } from './dto/update-word.dto';

@Injectable()
export class WordListService {
  constructor(
    @InjectRepository(WordList)
    private wordListRepository: Repository<WordList>,
  ) {}

  async create(userId: string, createWordDto: CreateWordDto): Promise<WordList> {
    // Check if word already exists for this user
    const existing = await this.wordListRepository.findOne({
      where: {
        userId,
        word: createWordDto.word.toLowerCase().trim(),
      },
    });

    if (existing) {
      throw new ConflictException('Word already exists in your list');
    }

    const wordList = this.wordListRepository.create({
      userId,
      word: createWordDto.word.toLowerCase().trim(),
      notes: createWordDto.notes,
    });

    return this.wordListRepository.save(wordList);
  }

  async findAll(userId: string, search?: string): Promise<WordList[]> {
    const queryBuilder = this.wordListRepository
      .createQueryBuilder('word_list')
      .where('word_list.user_id = :userId', { userId })
      .orderBy('word_list.word', 'ASC');

    if (search) {
      queryBuilder.andWhere('word_list.word ILIKE :search', {
        search: `%${search}%`,
      });
    }

    return queryBuilder.getMany();
  }

  async findOne(userId: string, id: string): Promise<WordList> {
    const wordList = await this.wordListRepository.findOne({
      where: { id, userId },
    });

    if (!wordList) {
      throw new NotFoundException('Word not found in your list');
    }

    return wordList;
  }

  async update(
    userId: string,
    id: string,
    updateWordDto: UpdateWordDto,
  ): Promise<WordList> {
    const wordList = await this.findOne(userId, id);

    Object.assign(wordList, updateWordDto);

    return this.wordListRepository.save(wordList);
  }

  async remove(userId: string, id: string): Promise<void> {
    const wordList = await this.findOne(userId, id);
    await this.wordListRepository.remove(wordList);
  }

  async removeByWord(userId: string, word: string): Promise<void> {
    const result = await this.wordListRepository.delete({
      userId,
      word: word.toLowerCase().trim(),
    });

    if (result.affected === 0) {
      throw new NotFoundException('Word not found in your list');
    }
  }

  async clear(userId: string): Promise<void> {
    await this.wordListRepository.delete({ userId });
  }

  async import(userId: string, words: string[]): Promise<{ added: number; skipped: number }> {
    let added = 0;
    let skipped = 0;

    for (const word of words) {
      const cleanWord = word.toLowerCase().trim();
      if (!cleanWord) continue;

      try {
        const existing = await this.wordListRepository.findOne({
          where: { userId, word: cleanWord },
        });

        if (!existing) {
          const wordList = this.wordListRepository.create({
            userId,
            word: cleanWord,
          });
          await this.wordListRepository.save(wordList);
          added++;
        } else {
          skipped++;
        }
      } catch (error) {
        skipped++;
      }
    }

    return { added, skipped };
  }
}
