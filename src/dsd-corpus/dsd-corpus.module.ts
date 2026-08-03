import { DynamicModule, Logger, Module, OnApplicationBootstrap } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  DsdCorpusConfig,
  buildDsdCorpusConfig,
  dsdMustBeAvailable,
} from './dsd-corpus.config';
import { createDsdDataSource } from './dsd-corpus.datasource';
import { DsdCorpusController } from './dsd-corpus.controller';
import { DsdQueryService } from './dsd-query.service';

export const DSD_DATA_SOURCE = 'DSD_DATA_SOURCE';
export const DSD_CORPUS_CONFIG = 'DSD_CORPUS_CONFIG';

/**
 * Wires the DSD corpus into the application as the `dsd_app` role only.
 *
 * Fail-closed by release channel:
 *   `internal` / `public` — DSD is serving, so an unavailable connection is a
 *                           startup failure.
 *   `off`                 — DSD serves nothing; user, auth and progress routes
 *                           stay healthy and dictionary routes return 404.
 *                           They never fall back to legacy content.
 */
@Module({})
export class DsdCorpusModule implements OnApplicationBootstrap {
  private static readonly logger = new Logger('DsdCorpusModule');

  static forRoot(config: DsdCorpusConfig = buildDsdCorpusConfig()): DynamicModule {
    const required = dsdMustBeAvailable(config.releaseChannel);

    if (required && config.errors.length > 0) {
      // Refuse to boot rather than serve a channel we cannot back.
      throw new Error(
        `DSD release channel is '${config.releaseChannel}' but its configuration is invalid:\n  - ` +
          config.errors.join('\n  - '),
      );
    }

    return {
      module: DsdCorpusModule,
      global: true,
      controllers: [DsdCorpusController],
      providers: [
        DsdQueryService,
        { provide: DSD_CORPUS_CONFIG, useValue: config },
        {
          provide: DSD_DATA_SOURCE,
          useFactory: async (): Promise<DataSource | null> => {
            if (!required) {
              DsdCorpusModule.logger.log(
                `DSD release channel is 'off'; DSD data source not initialized.`,
              );
              return null;
            }

            const dataSource = createDsdDataSource('app', config);
            await dataSource.initialize();
            DsdCorpusModule.logger.log(
              `DSD data source connected as 'dsd_app' to '${config.database}' (channel: ${config.releaseChannel}).`,
            );
            return dataSource;
          },
        },
      ],
      exports: [DSD_DATA_SOURCE, DSD_CORPUS_CONFIG, DsdQueryService],
    };
  }

  onApplicationBootstrap(): void {
    // Task 15 adds the routing assertions that depend on this module.
  }
}
