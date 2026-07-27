import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { LearnerEntry } from '../dictionary/entities/learner-entry.entity';
import { WordList } from '../word-list/entities/word-list.entity';
import { LookupHistory } from './entities/lookup-history.entity';
import { WordFolder } from './entities/word-folder.entity';
import { ReviewRating, scheduleReview } from './leitner';

@Injectable()
export class LearningService {
  constructor(
    @InjectRepository(LookupHistory) private historyRepo: Repository<LookupHistory>,
    @InjectRepository(WordFolder) private folderRepo: Repository<WordFolder>,
    @InjectRepository(WordList) private wordRepo: Repository<WordList>,
    @InjectRepository(LearnerEntry) private learnerEntryRepo: Repository<LearnerEntry>,
  ) {}

  history(userId: string) {
    return this.historyRepo.find({ where: { userId }, order: { createdAt: 'DESC' }, take: 100 });
  }

  recordHistory(userId: string, body: Partial<LookupHistory>) {
    return this.historyRepo.save(this.historyRepo.create({
      userId,
      query: body.query?.trim().slice(0, 255),
      direction: body.direction === 'vi-en' ? 'vi-en' : 'en-vi',
      canonicalResult: body.canonicalResult?.slice(0, 255) || null,
    }));
  }

  async importHistory(userId: string, items: Partial<LookupHistory>[]) {
    const safeItems = items.slice(0, 500);
    await this.historyRepo.save(safeItems.map(item => this.historyRepo.create({
      userId,
      query: item.query?.trim().slice(0, 255),
      direction: item.direction === 'vi-en' ? 'vi-en' : 'en-vi',
      canonicalResult: item.canonicalResult?.slice(0, 255) || null,
    })));
    return { imported: safeItems.length };
  }

  async clearHistory(userId: string) { await this.historyRepo.delete({ userId }); }
  folders(userId: string) { return this.folderRepo.find({ where: { userId }, order: { name: 'ASC' } }); }

  async createFolder(userId: string, name: string, color?: string) {
    const normalized = name.trim();
    if (await this.folderRepo.findOne({ where: { userId, name: normalized } })) throw new ConflictException('Folder already exists');
    return this.folderRepo.save(this.folderRepo.create({ userId, name: normalized, color: color || '#F4A300' }));
  }

  async updateFolder(userId: string, id: string, body: { name?: string; color?: string }) {
    const folder = await this.folderRepo.findOne({ where: { id, userId } });
    if (!folder) throw new NotFoundException('Folder not found');
    if (body.name?.trim()) folder.name = body.name.trim();
    if (body.color) folder.color = body.color;
    return this.folderRepo.save(folder);
  }

  async removeFolder(userId: string, id: string) {
    const folder = await this.folderRepo.findOne({ where: { id, userId } });
    if (!folder) throw new NotFoundException('Folder not found');
    const words = await this.wordRepo.find({ where: { userId } });
    await this.wordRepo.save(words.filter(w => w.folderIds?.includes(id)).map(w => ({ ...w, folderIds: w.folderIds.filter(folderId => folderId !== id) })));
    await this.folderRepo.remove(folder);
  }

  async setMembership(userId: string, folderId: string, wordId: string, include: boolean) {
    if (!await this.folderRepo.findOne({ where: { id: folderId, userId } })) throw new NotFoundException('Folder not found');
    const word = await this.wordRepo.findOne({ where: { id: wordId, userId } });
    if (!word) throw new NotFoundException('Saved word not found');
    const ids = new Set(word.folderIds || []);
    include ? ids.add(folderId) : ids.delete(folderId);
    word.folderIds = [...ids];
    return this.wordRepo.save(word);
  }

  async due(userId: string) {
    const candidates = await this.wordRepo.find({
      where: { userId, nextReviewAt: LessThanOrEqual(new Date()) },
      order: { nextReviewAt: 'ASC' },
    });
    const eligibleWords = await this.findReviewEligibleWords(candidates.map(word => word.word));

    return candidates
      .filter(word => eligibleWords.has(this.normalizeReviewWord(word.word)))
      .slice(0, 100);
  }

  async rate(userId: string, wordId: string, rating: ReviewRating) {
    if (!['again', 'hard', 'easy'].includes(rating)) {
      throw new BadRequestException('Rating must be again, hard, or easy');
    }
    const word = await this.wordRepo.findOne({ where: { id: wordId, userId } });
    if (!word) throw new NotFoundException('Saved word not found');
    const eligibleWords = await this.findReviewEligibleWords([word.word]);
    if (!eligibleWords.has(this.normalizeReviewWord(word.word))) {
      throw new BadRequestException(
        'Saved word is reference-only and cannot be reviewed until its learner content is approved',
      );
    }
    const next = scheduleReview(word.reviewStage, rating);
    word.reviewStage = next.stage;
    word.nextReviewAt = next.nextReviewAt;
    word.lastReviewedAt = new Date();
    if (rating === 'again') word.reviewFailures += 1; else word.reviewSuccesses += 1;
    return this.wordRepo.save(word);
  }

  async sync(userId: string, body: { history?: any[]; folders?: any[]; words?: any[] }) {
    if (body.history?.length) await this.importHistory(userId, body.history);
    const folderMap = new Map<string, string>();
    for (const local of (body.folders || []).slice(0, 100)) {
      let folder = await this.folderRepo.findOne({ where: { userId, name: String(local.name).trim() } });
      if (!folder) folder = await this.folderRepo.save(this.folderRepo.create({ userId, name: String(local.name).trim().slice(0, 80), color: local.color || '#F4A300' }));
      folderMap.set(local.id, folder.id);
    }
    let mergedWords = 0;
    for (const local of (body.words || []).slice(0, 2000)) {
      const normalized = String(local.word || '').toLowerCase().trim();
      if (!normalized) continue;
      let word = await this.wordRepo.findOne({ where: { userId, word: normalized } });
      const mappedFolders = (local.folderIds || []).map((id: string) => folderMap.get(id)).filter(Boolean) as string[];
      if (!word) word = this.wordRepo.create({ userId, word: normalized, notes: local.notes, folderIds: mappedFolders, reviewStage: Math.min(5, Math.max(0, local.reviewStage || 0)), nextReviewAt: local.nextReviewAt ? new Date(local.nextReviewAt) : new Date(), reviewSuccesses: local.reviewSuccesses || 0, reviewFailures: local.reviewFailures || 0 });
      else {
        word.folderIds = [...new Set([...(word.folderIds || []), ...mappedFolders])];
        word.reviewStage = Math.max(word.reviewStage, Math.min(5, local.reviewStage || 0));
        word.reviewSuccesses = Math.max(word.reviewSuccesses, local.reviewSuccesses || 0);
        word.reviewFailures = Math.max(word.reviewFailures, local.reviewFailures || 0);
      }
      await this.wordRepo.save(word); mergedWords += 1;
    }
    return { importedHistory: Math.min(body.history?.length || 0, 500), mergedFolders: folderMap.size, mergedWords };
  }

  /**
   * A saved word may enter the review loop only when its normalized learner
   * entry is published and at least one published sense has an approved
   * Vietnamese translation. Raw dictionary rows remain lookup-only.
   */
  private async findReviewEligibleWords(words: string[]): Promise<Set<string>> {
    const normalizedWords = [...new Set(words.map(word => this.normalizeReviewWord(word)).filter(Boolean))];
    if (!normalizedWords.length) return new Set();

    const eligible = new Set<string>();
    const chunkSize = 1000;

    for (let offset = 0; offset < normalizedWords.length; offset += chunkSize) {
      const headwords = normalizedWords.slice(offset, offset + chunkSize);
      const entries = await this.learnerEntryRepo
        .createQueryBuilder('entry')
        .innerJoinAndSelect('entry.word', 'dictionaryWord')
        .innerJoin(
          'entry.senses',
          'sense',
          'sense.status = :senseStatus',
          { senseStatus: 'published' },
        )
        .innerJoin(
          'sense.translations',
          'translation',
          `translation.reviewStatus = :translationStatus
            AND (
              LOWER(translation.locale) = :translationLocale
              OR LOWER(translation.locale) LIKE :translationLocalePrefix
            )`,
          {
            translationStatus: 'approved',
            translationLocale: 'vi',
            translationLocalePrefix: 'vi-%',
          },
        )
        .where('entry.status = :entryStatus', { entryStatus: 'published' })
        .andWhere(
          `(
            LOWER(BTRIM(dictionaryWord.word)) IN (:...headwords)
            OR LOWER(BTRIM(dictionaryWord."word_normalized")) IN (:...headwords)
          )`,
          { headwords },
        )
        .select([
          'entry.id',
          'dictionaryWord.id',
          'dictionaryWord.word',
          'dictionaryWord.wordNormalized',
        ])
        .distinct(true)
        .getMany();

      for (const entry of entries) {
        eligible.add(this.normalizeReviewWord(entry.word?.word));
        eligible.add(this.normalizeReviewWord(entry.word?.wordNormalized));
      }
    }

    eligible.delete('');
    return eligible;
  }

  private normalizeReviewWord(word: string | null | undefined): string {
    return String(word || '').trim().toLocaleLowerCase('en-US');
  }
}
