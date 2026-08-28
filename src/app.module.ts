import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LlmModule } from './llm/llm.module';
import { DictionaryModule } from './dictionary/dictionary.module';
import { AuthModule } from './auth/auth.module';
import { WordListModule } from './word-list/word-list.module';
import { CategoryModule } from './category/category.module';
import { VerbalMappingModule } from './verbal-mapping/verbal-mapping.module';
import { TtsModule } from './shared/tts/tts.module';
import { LearningModule } from './learning/learning.module';
import configuration from './config/configuration';
import { LEGACY_ENTITIES } from './config/legacy-entities';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT, 10) || 5432,
      username: process.env.DB_USERNAME || 'dictionary_user',
      password: process.env.DB_PASSWORD || 'dictionary_pass',
      database: process.env.DB_DATABASE || 'english_learning_db',
      entities: LEGACY_ENTITIES,
      // Migrations are the schema source of truth. Development schema sync must
      // be an explicit, temporary opt-in so it cannot pre-create migration tables.
      synchronize: process.env.TYPEORM_SYNCHRONIZE === 'true',
      logging: process.env.NODE_ENV === 'development',
    }),
    LlmModule,
    DictionaryModule,
    AuthModule,
    WordListModule,
    CategoryModule,
    VerbalMappingModule,
    TtsModule,
    LearningModule,
  ],
})
export class AppModule {}
