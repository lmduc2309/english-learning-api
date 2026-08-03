import {
  Controller,
  Get,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { DSD_CORPUS_CONFIG } from './dsd-corpus.module';
import { DsdCorpusConfig } from './dsd-corpus.config';
import { DsdQueryService } from './dsd-query.service';
import {
  DsdPublicEntry,
  DsdPublicSearchHit,
  presentEntry,
  presentSearchHits,
} from './dsd-presenter';

/**
 * The DSD serving surface.
 *
 * Three channels, and the difference between them is what a *public* request can
 * reach:
 *
 *   off       nothing. Lookup and search behave as if the word does not exist.
 *             User, auth and progress features are untouched — they do not go
 *             through here.
 *   internal  the active release, to authenticated DSD reviewers only. A public
 *             request behaves exactly as `off`.
 *   public    the active release, to everyone, and only from a release whose id
 *             says it is public-eligible.
 *
 * A miss is a 404. It is never a fallback: this controller has no legacy
 * connection, so there is nothing to fall back to even if someone wanted it.
 * That is the point of putting the boundary here rather than in a branch.
 */

export type DsdAccess = 'public' | 'reviewer';

@Controller('dsd')
export class DsdCorpusController {
  private readonly logger = new Logger(DsdCorpusController.name);

  constructor(
    private readonly queryService: DsdQueryService,
    @Inject(DSD_CORPUS_CONFIG) private readonly config: DsdCorpusConfig,
  ) {}

  /**
   * Whether a request at this access level may be served.
   *
   * Exported logic rather than a guard so it can be tested exhaustively without
   * standing up the HTTP layer, and so the reasoning is in one readable place.
   */
  canServe(access: DsdAccess): boolean {
    switch (this.config.releaseChannel) {
      case 'off':
        return false;
      case 'internal':
        // A public request on the internal channel is indistinguishable from the
        // off channel, deliberately: an internal pilot must not be discoverable.
        return access === 'reviewer';
      case 'public':
        return true;
      default:
        return false;
    }
  }

  @Get('health')
  health(): {
    channel: string;
    release_id: string | null;
    serving: boolean;
    connected: boolean;
  } {
    return {
      channel: this.config.releaseChannel,
      // Null rather than empty on `off`, where the id is meaningless.
      release_id: this.config.releaseChannel === 'off' ? null : this.config.activeReleaseId,
      serving: this.canServe('public'),
      connected: this.queryService.available,
    };
  }

  @Get('entries/:identifier')
  async lookup(
    @Param('identifier') identifier: string,
    @Query('access') access?: string,
  ): Promise<DsdPublicEntry> {
    if (!this.canServe(this.resolveAccess(access))) {
      throw new NotFoundException('not_found');
    }

    const aggregate = await this.queryService.findCompleteEntry(identifier);
    if (!aggregate) {
      // Covers three cases on purpose — no such entry, not published, published
      // but incomplete — because distinguishing them would tell an outsider what
      // exists in an unreleased corpus.
      throw new NotFoundException('not_found');
    }

    return presentEntry(aggregate, {
      releaseId: this.config.activeReleaseId,
      audioBaseUrl: process.env.DSD_AUDIO_PUBLIC_BASE_URL ?? '',
    });
  }

  @Get('search')
  async search(
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('access') access?: string,
  ): Promise<{ results: DsdPublicSearchHit[]; corpus_release_id: string | null }> {
    if (!this.canServe(this.resolveAccess(access))) {
      return { results: [], corpus_release_id: null };
    }

    const hits = await this.queryService.search(q ?? '', limit ? Number(limit) : 20);
    return {
      results: presentSearchHits(hits),
      corpus_release_id: this.config.activeReleaseId,
    };
  }

  /**
   * Reviewer access is asserted by the authentication layer, not by a query
   * parameter. Until that route exists, everything is public — which fails
   * closed, because a public request can only reach the public channel.
   */
  private resolveAccess(_access?: string): DsdAccess {
    return 'public';
  }
}
